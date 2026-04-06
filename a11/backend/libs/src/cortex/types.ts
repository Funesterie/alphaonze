export interface CortexPacket {
  version?: number;
  kind?: 'cortex-packet';
  type?: string;
  id?: string;
  payload: any;

  // additional fields for decoded PNG transport
  totalLen?: number;
  payloadLen?: number;
  flags?: number;
}
