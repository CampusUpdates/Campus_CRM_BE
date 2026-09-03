export interface CallSession {
  callId: string;
  phoneNumber: string;
  status: 'READY' | 'CALLING' | 'CONNECTED' | 'ENDED' | 'FAILED';
  startedAt?: Date;
  connectedAt?: Date;
  endedAt?: Date;
  durationSeconds?: number;
}

export interface TelephonyProvider {
  initiateCall(phoneNumber: string): Promise<CallSession>;
  getCallStatus(callId: string): Promise<CallSession>;
  endCall(callId: string): Promise<CallSession>;
}
