import { Injectable } from '@nestjs/common';
import { AttendancePolicy, AttendanceStatus } from '@prisma/client';

@Injectable()
export class AttendanceClassificationService {
  /**
   * Classifies attendance based on the provided policy.
   * Assumes loginTime is a Date object representing the time of the first valid office login.
   * Boundaries:
   * login <= officeStart => PRESENT
   * officeStart < login <= casualLeaveCutoff => CASUAL_LEAVE
   * casualLeaveCutoff < login <= halfDayCutoff => HALF_DAY
   * login > halfDayCutoff => HALF_DAY
   */
  classifyAttendance(
    loginTime: Date,
    policy: AttendancePolicy,
  ): AttendanceStatus {
    const loginMinutes = loginTime.getHours() * 60 + loginTime.getMinutes();

    const parseTime = (timeString: string) => {
      const [hours, minutes] = timeString.split(':').map(Number);
      return hours * 60 + minutes;
    };

    const officeStart = parseTime(policy.officeStartTime);
    const casualLeave = parseTime(policy.casualLeaveCutoff);
    const halfDay = parseTime(policy.halfDayCutoff);

    if (loginMinutes <= officeStart) {
      return 'PRESENT';
    } else if (loginMinutes <= casualLeave) {
      return 'CASUAL_LEAVE';
    } else {
      return 'HALF_DAY';
    }
  }
}
