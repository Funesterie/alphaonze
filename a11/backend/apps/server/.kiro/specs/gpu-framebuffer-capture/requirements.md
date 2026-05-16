# Requirements Document

## Introduction

This feature replaces the current slow, file-based PowerShell screenshot capture mechanism with a direct GPU framebuffer capture service. The service uses the DXGI Desktop Duplication API (or NVFBC for NVIDIA GPUs) to capture frames at near real-time latency (<16ms), making them available to the Janus-Pro-7B vision analysis pipeline via shared memory or a local HTTP endpoint. This eliminates the ~500ms+ file I/O bottleneck and enables responsive game-state analysis for the Qflush automation pipeline.

## Glossary

- **Capture_Service**: The Windows service/daemon responsible for acquiring GPU framebuffer data via DXGI Desktop Duplication or NVFBC APIs
- **Frame_Buffer**: A region of memory containing raw pixel data representing a single captured display frame
- **DXGI_Duplicator**: The component within the Capture_Service that interfaces with the Windows DXGI Desktop Duplication API
- **NVFBC_Duplicator**: The optional component within the Capture_Service that interfaces with NVIDIA's NvFBC (Frame Buffer Capture) API for lower-latency capture on NVIDIA GPUs
- **Frame_Ring_Buffer**: A fixed-size circular buffer in shared memory holding the N most recent captured frames
- **Janus_Worker**: The Python process (janus_vision_worker.py) running Janus-Pro-7B for vision-text inference
- **Janus_Runtime**: The Node.js module (janus-vision-runtime.cjs) that manages the Janus_Worker lifecycle and sends inference requests
- **Qflush_Pipeline**: The existing automation pipeline that coordinates gamepad/keyboard/mouse input and frame analysis for game demos
- **Frame_Provider**: The interface layer that exposes captured frames to consumers (Janus_Runtime, MCP tools) via shared memory or local HTTP
- **Capture_Target**: A specification of what to capture — a specific window handle, a specific monitor, or the full desktop
- **Frame_Metadata**: Timestamp, resolution, capture target identifier, and sequence number associated with each captured frame
- **Analysis_Throttle**: The rate-limiting mechanism that controls how many frames per second are sent to Janus_Worker for inference

## Requirements

### Requirement 1: GPU Frame Capture via DXGI Desktop Duplication

**User Story:** As a developer, I want the system to capture frames directly from the GPU using the DXGI Desktop Duplication API, so that frame acquisition latency drops from 500ms+ to under 16ms.

#### Acceptance Criteria

1. WHEN the Capture_Service is started, THE DXGI_Duplicator SHALL acquire frames from the GPU framebuffer using the IDXGIOutputDuplication interface
2. WHEN a frame is acquired, THE DXGI_Duplicator SHALL copy the GPU texture to a CPU-accessible staging buffer within 16ms
3. WHILE the Capture_Service is running, THE DXGI_Duplicator SHALL maintain a sustained capture rate of at least 60 frames per second
4. IF the DXGI Desktop Duplication API is unavailable or returns an error, THEN THE Capture_Service SHALL log the error and attempt reinitialization after 1 second
5. IF the desktop session is locked or switched, THEN THE Capture_Service SHALL pause capture and resume automatically when the session becomes active again

### Requirement 2: NVIDIA NvFBC Capture (Optional Path)

**User Story:** As a developer with an NVIDIA GPU, I want the system to use NvFBC when available, so that I get even lower capture latency and reduced CPU overhead.

#### Acceptance Criteria

1. WHEN the Capture_Service starts and an NVIDIA GPU with NvFBC support is detected, THE NVFBC_Duplicator SHALL be used as the primary capture backend
2. IF NvFBC is not available or fails to initialize, THEN THE Capture_Service SHALL fall back to the DXGI_Duplicator without interruption
3. WHILE using NvFBC, THE NVFBC_Duplicator SHALL capture frames with less than 8ms latency per frame
4. THE NVFBC_Duplicator SHALL support direct GPU-to-system-memory transfer without intermediate copies

### Requirement 3: Capture Target Selection

**User Story:** As a developer, I want to capture specific windows, monitors, or the full desktop, so that I can focus analysis on the relevant game content.

#### Acceptance Criteria

1. THE Capture_Service SHALL support three capture modes: full-desktop, specific-monitor, and specific-window
2. WHEN a specific window handle is provided as the Capture_Target, THE Capture_Service SHALL crop the captured frame to the window's client area
3. WHEN a specific monitor index is provided as the Capture_Target, THE Capture_Service SHALL capture only that monitor's output
4. WHEN no Capture_Target is specified, THE Capture_Service SHALL default to the primary monitor
5. WHEN the target window is moved, resized, or minimized, THE Capture_Service SHALL track the window position and adjust the capture region accordingly
6. IF the target window is closed or becomes invalid, THEN THE Capture_Service SHALL emit a target-lost event and pause capture until a new target is configured

### Requirement 4: Frame Ring Buffer and Shared Memory Transport

**User Story:** As a developer, I want captured frames available in shared memory, so that the Janus worker can read them without file I/O or network overhead.

#### Acceptance Criteria

1. THE Frame_Ring_Buffer SHALL store the most recent N frames (configurable, default 4) in a named shared memory region
2. WHEN a new frame is captured, THE Capture_Service SHALL write the frame data and Frame_Metadata to the next slot in the Frame_Ring_Buffer
3. THE Frame_Metadata SHALL include: timestamp (microsecond precision), frame sequence number, resolution (width and height), pixel format, and Capture_Target identifier
4. WHILE the Frame_Ring_Buffer is full, THE Capture_Service SHALL overwrite the oldest frame slot
5. THE Frame_Ring_Buffer SHALL use a lock-free single-producer/single-consumer design to avoid blocking the capture thread
6. WHEN a consumer reads a frame from the Frame_Ring_Buffer, THE Frame_Provider SHALL validate the frame sequence number to detect torn reads

### Requirement 5: Local HTTP Frame Endpoint

**User Story:** As a developer, I want an optional local HTTP endpoint to retrieve the latest frame, so that tools and scripts can access captures without shared memory bindings.

#### Acceptance Criteria

1. WHERE the HTTP endpoint is enabled, THE Frame_Provider SHALL serve the latest captured frame at a local-only HTTP endpoint on a configurable port (default 9120)
2. WHEN a GET request is received at the frame endpoint, THE Frame_Provider SHALL return the most recent frame as a JPEG or PNG image with Frame_Metadata in response headers
3. THE Frame_Provider SHALL bind exclusively to 127.0.0.1 and reject connections from non-loopback addresses
4. WHEN the frame endpoint receives a request with an Accept header specifying image/jpeg, THE Frame_Provider SHALL return JPEG-compressed output (configurable quality, default 85)
5. WHEN the frame endpoint receives a request with an Accept header specifying image/png, THE Frame_Provider SHALL return PNG output
6. IF no frame has been captured yet, THEN THE Frame_Provider SHALL return HTTP 503 with a descriptive error body

### Requirement 6: Analysis Throttle and Rate Control

**User Story:** As a developer, I want to control how many frames per second are sent to Janus for analysis, so that GPU/CPU resources are not wasted on redundant inference.

#### Acceptance Criteria

1. THE Analysis_Throttle SHALL limit the rate of frames forwarded to Janus_Worker to a configurable value (default 2 fps, range 0.5–10 fps)
2. WHEN the Analysis_Throttle determines a frame should be analyzed, THE Frame_Provider SHALL make that frame available to the Janus_Runtime
3. WHILE the Janus_Worker is processing a previous frame, THE Analysis_Throttle SHALL skip sending new frames until the current inference completes
4. THE Analysis_Throttle SHALL support a burst mode where a single on-demand frame can be requested regardless of the rate limit
5. WHEN the Analysis_Throttle rate is changed at runtime, THE Capture_Service SHALL apply the new rate within 1 second without restarting

### Requirement 7: Integration with Janus Vision Runtime

**User Story:** As a developer, I want the Janus runtime to consume frames from the Capture_Service instead of reading screenshot files from disk, so that the vision pipeline operates with minimal latency.

#### Acceptance Criteria

1. WHEN the Capture_Service is running and frames are available, THE Janus_Runtime SHALL read frames from the Frame_Ring_Buffer (shared memory) or the local HTTP endpoint
2. THE Janus_Runtime SHALL pass the frame buffer directly to the Janus_Worker as a base64-encoded image without writing to disk
3. WHEN the Capture_Service is unavailable, THE Janus_Runtime SHALL fall back to the existing file-based screenshot capture method
4. THE Janus_Runtime SHALL expose a configuration option (A11_CAPTURE_SOURCE) to select between gpu-capture, http-endpoint, and legacy-screenshot modes
5. WHEN a frame is received from the Capture_Service, THE Janus_Runtime SHALL include the Frame_Metadata timestamp in the analysis result for freshness validation

### Requirement 8: Integration with Qflush MCP Tools

**User Story:** As an agent using MCP tools, I want qflush_janus_analyze and qflush_media_analyze to use GPU-captured frames, so that game state analysis is near real-time.

#### Acceptance Criteria

1. WHEN qflush_janus_analyze is called, THE Qflush_Pipeline SHALL retrieve the latest frame from the Capture_Service instead of reading from the captures directory
2. WHEN qflush_media_analyze is called with video mode, THE Qflush_Pipeline SHALL combine the GPU-captured frame with the audio analysis
3. THE Qflush_Pipeline SHALL validate frame freshness using the Frame_Metadata timestamp and reject frames older than the configured maxAgeMs parameter
4. IF the Capture_Service is not running, THEN THE Qflush_Pipeline SHALL fall back to the existing PowerShell screenshot method and log a warning

### Requirement 9: Service Lifecycle Management

**User Story:** As a developer, I want to start, stop, and configure the Capture_Service from PowerShell or as a Windows service, so that it integrates with my existing workflow.

#### Acceptance Criteria

1. THE Capture_Service SHALL be startable as a foreground console process via a PowerShell command
2. THE Capture_Service SHALL be installable and runnable as a Windows service (via sc.exe or a service installer)
3. WHEN the Capture_Service receives a stop signal (SIGTERM, service stop, or console Ctrl+C), THE Capture_Service SHALL release all GPU resources, unmap shared memory, and exit cleanly within 2 seconds
4. THE Capture_Service SHALL accept configuration via environment variables, a JSON config file, or command-line arguments (in that priority order)
5. WHEN the Capture_Service starts, THE Capture_Service SHALL log its configuration (capture target, rate, shared memory name, HTTP port) to stdout and to a log file

### Requirement 10: Memory Management and Resource Safety

**User Story:** As a developer, I want the capture pipeline to manage GPU and system memory safely, so that long-running sessions do not leak resources or degrade performance.

#### Acceptance Criteria

1. WHILE the Capture_Service is running, THE Capture_Service SHALL maintain constant memory usage regardless of session duration (no memory leaks)
2. WHEN a GPU texture is acquired, THE Capture_Service SHALL release the texture reference before acquiring the next frame
3. THE Frame_Ring_Buffer SHALL use a fixed allocation size determined at startup and SHALL NOT grow dynamically
4. IF the Capture_Service detects that available GPU memory drops below 256MB, THEN THE Capture_Service SHALL reduce capture resolution or pause capture and emit a warning
5. WHEN the Capture_Service exits, THE Capture_Service SHALL unmap and close all shared memory handles and release all DXGI/NvFBC resources

### Requirement 11: Fallback to Legacy Screenshot Method

**User Story:** As a developer, I want the system to gracefully fall back to the existing PowerShell screenshot method if GPU capture fails, so that the pipeline remains functional on unsupported hardware.

#### Acceptance Criteria

1. IF the Capture_Service fails to initialize both DXGI and NvFBC backends, THEN THE Capture_Service SHALL exit with a descriptive error code and message
2. WHEN the Janus_Runtime detects that the Capture_Service is not running, THE Janus_Runtime SHALL use the legacy PowerShell screenshot method (Watch-RomStationState.ps1 or equivalent)
3. WHEN the Capture_Service becomes available after a fallback period, THE Janus_Runtime SHALL switch back to GPU capture within 5 seconds
4. THE Janus_Runtime SHALL log each transition between GPU capture and legacy fallback modes

### Requirement 12: Security and Local-Only Access

**User Story:** As a developer, I want the capture service to have no network exposure, so that frame data cannot be accessed remotely.

#### Acceptance Criteria

1. THE Capture_Service SHALL bind all network endpoints exclusively to 127.0.0.1
2. THE Capture_Service SHALL NOT accept or process connections from non-loopback network interfaces
3. THE Frame_Ring_Buffer shared memory region SHALL use a randomized name prefix to prevent unauthorized access from other local processes
4. THE Capture_Service SHALL NOT transmit frame data to any remote endpoint
5. IF a connection attempt is received from a non-loopback address, THEN THE Capture_Service SHALL reject the connection and log a security warning

### Requirement 13: Frame Format and Encoding

**User Story:** As a developer, I want captured frames in a format directly consumable by Janus-Pro-7B, so that no additional conversion step is needed.

#### Acceptance Criteria

1. THE Capture_Service SHALL store frames in the Frame_Ring_Buffer in BGRA32 pixel format (native DXGI format)
2. WHEN the Frame_Provider serves a frame via HTTP, THE Frame_Provider SHALL encode the frame to JPEG or PNG based on the request
3. WHEN the Janus_Runtime reads from shared memory, THE Janus_Runtime SHALL convert BGRA32 to RGB and encode as PNG or JPEG before sending to the Janus_Worker
4. THE Frame_Provider SHALL support optional downscaling (configurable target resolution, default: preserve original) to reduce inference time
5. WHEN downscaling is configured, THE Frame_Provider SHALL use bilinear interpolation and maintain the original aspect ratio
