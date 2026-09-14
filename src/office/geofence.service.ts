import { Injectable } from '@nestjs/common';
import { Office } from '@prisma/client';

export interface MatchedOfficeResult {
  office: Office;
  distanceMeters: number;
}

@Injectable()
export class GeofenceService {
  /**
   * Calculates the geographic distance in meters between two lat/lon coordinates
   * using the Haversine formula.
   */
  calculateDistanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const EARTH_RADIUS_METERS = 6371000; // Earth's mean radius in meters

    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const radLat1 = toRadians(lat1);
    const radLat2 = toRadians(lat2);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(radLat1) *
        Math.cos(radLat2) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS_METERS * c;
  }

  /**
   * Finds the nearest active office configured with coordinates where the user is
   * physically inside the allowed radiusMeters.
   */
  findNearestMatchingOffice(
    userLat: number,
    userLon: number,
    activeOffices: Office[],
  ): MatchedOfficeResult | null {
    const configuredOffices = activeOffices.filter(
      (off) =>
        off.isActive &&
        off.latitude !== null &&
        off.latitude !== undefined &&
        off.longitude !== null &&
        off.longitude !== undefined,
    );

    const matches: MatchedOfficeResult[] = [];

    for (const office of configuredOffices) {
      const dist = this.calculateDistanceMeters(
        userLat,
        userLon,
        office.latitude!,
        office.longitude!,
      );

      const maxAllowedRadius = office.radiusMeters ?? 100;

      if (dist <= maxAllowedRadius) {
        matches.push({ office, distanceMeters: dist });
      }
    }

    if (matches.length === 0) {
      return null;
    }

    // Sort by distance ascending (nearest office first)
    matches.sort((a, b) => a.distanceMeters - b.distanceMeters);

    return matches[0];
  }
}
