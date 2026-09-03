import { Injectable, NotFoundException } from '@nestjs/common';
import { CallSession, TelephonyProvider } from '../interfaces/telephony-provider.interface';

@Injectable()
export class MockTelephonyProvider implements TelephonyProvider {
  private activeSessions = new Map<string, CallSession>();

  async initiateCall(phoneNumber: string): Promise<CallSession> {
    const callId = `mock-call-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date();


    const session: CallSession = {
      callId,
      phoneNumber,
      status: 'CALLING',
      startedAt: now,
      connectedAt: new Date(now.getTime() + 1000), // Simulate connection after 1 sec
    };

    this.activeSessions.set(callId, session);
    return session;
  }

  async getCallStatus(callId: string): Promise<CallSession> {
    const session = this.activeSessions.get(callId);
    if (!session) {
      throw new NotFoundException(`Mock call session ${callId} not found`);
    }

    if (session.status === 'CALLING' || session.status === 'CONNECTED') {
      const now = new Date();
      const startTime = session.connectedAt || session.startedAt || now;
      session.durationSeconds = Math.max(0, Math.floor((now.getTime() - startTime.getTime()) / 1000));
      session.status = 'CONNECTED';
    }

    return session;
  }

  async endCall(callId: string): Promise<CallSession> {
    const session = this.activeSessions.get(callId);
    if (!session) {
      // Fallback response if session expired
      return {
        callId,
        phoneNumber: 'N/A',
        status: 'ENDED',
        endedAt: new Date(),
        durationSeconds: 0,
      };
    }

    const now = new Date();
    const startTime = session.connectedAt || session.startedAt || now;
    const durationSeconds = Math.max(0, Math.floor((now.getTime() - startTime.getTime()) / 1000));

    session.status = 'ENDED';
    session.endedAt = now;
    session.durationSeconds = durationSeconds;

    this.activeSessions.delete(callId);
    return session;
  }
}
