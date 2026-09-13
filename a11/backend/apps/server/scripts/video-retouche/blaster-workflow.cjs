'use strict';
// Workflow API Comfy : retouche VACE d'une vraie video (clip + masque).
// Usage : node blaster-workflow.cjs <nom-webp> <nom-masque>  -> JSON sur stdout
const [video, masque] = process.argv.slice(2);
if (!video || !masque) { console.error('usage: <webp> <masque>'); process.exit(1); }

const W = 480, H = 832, N = 81;
// Essai 2 : les tirs sont DESSINES dans la video de controle ; la consigne les nomme
// pour que le modele les rende en vrais eclairs lumineux au lieu de les effacer.
const positif = 'Handheld phone video in a bright bedroom. A hand holds a futuristic sci-fi energy blaster pistol with a glowing blue energy core. The blaster fires three thick glowing blue plasma laser bolts that streak from its muzzle across the room and strike a small toy pirate figure with a straw hat standing on the white shelf. Each hit makes a bright blue energy explosion with sparks and a small puff of smoke on the toy figure. The blue light of each shot reflects on the hand and the wall. Realistic lighting, sharp detail, cinematic visual effects.';
const negatif = 'blurry, low quality, distorted hand, extra fingers, deformed fingers, static image, frozen frames, watermark, text, subtitles, cartoon, painting';

const wf = {
  // 1.3B par defaut : le 14B depasse la duree maximale d'un job Comfy Cloud sur 81 images.
  1: { class_type: 'UNETLoader', inputs: { unet_name: process.env.VACE_MODEL || 'wan2.1_vace_1.3B_fp16.safetensors', weight_dtype: 'default' } },
  2: { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan' } },
  3: { class_type: 'VAELoader', inputs: { vae_name: 'wan_2.1_vae.safetensors' } },
  4: { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift: 8 } },
  5: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: positif } },
  6: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: negatif } },
  7: { class_type: 'LoadImage', inputs: { image: video } },
  8: { class_type: 'LoadImage', inputs: { image: masque } },
  9: { class_type: 'RepeatImageBatch', inputs: { image: ['8', 0], amount: N } },
  10: { class_type: 'ImageToMask', inputs: { image: ['9', 0], channel: 'red' } },
  11: { class_type: 'WanVaceToVideo', inputs: {
    positive: ['5', 0], negative: ['6', 0], vae: ['3', 0],
    width: W, height: H, length: N, batch_size: 1, strength: 1,
    control_video: ['7', 0], control_masks: ['10', 0],
  } },
  12: { class_type: 'KSampler', inputs: {
    model: ['4', 0], seed: 3034, steps: 30, cfg: 6, sampler_name: 'uni_pc', scheduler: 'simple',
    positive: ['11', 0], negative: ['11', 1], latent_image: ['11', 2], denoise: 1,
  } },
  13: { class_type: 'TrimVideoLatent', inputs: { samples: ['12', 0], trim_amount: ['11', 3] } },
  14: { class_type: 'VAEDecode', inputs: { samples: ['13', 0], vae: ['3', 0] } },
  15: { class_type: 'VHS_VideoCombine', inputs: {
    images: ['14', 0], frame_rate: 16, loop_count: 0, filename_prefix: 'a11-blaster-essai2',
    format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 19, save_metadata: false, trim_to_audio: false,
    pingpong: false, save_output: true,
  } },
};
process.stdout.write(JSON.stringify(wf));
