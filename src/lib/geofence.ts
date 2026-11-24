import type {
  AttendanceRecord,
  GeofenceStatus,
  OfficeGeofenceConfig,
  OfficeLocation,
} from "./types";

export const DEFAULT_OFFICE_GEOFENCE: OfficeGeofenceConfig = {
  enabled: true,
  officeName: "SACE Headquarters",
  latitude: 17.385044,
  longitude: 78.486671,
  radiusMeters: 100,
  offices: [
    {
      id: "office-hq",
      name: "SACE Headquarters",
      latitude: 17.385044,
      longitude: 78.486671,
      radiusMeters: 100,
      enabled: true,
    },
  ],
  shiftStartTime: "09:30",
  shiftEndTime: "18:30",
  lateCarryoverEnabled: true,
};

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Computes exact great-circle distance in meters between two WGS-84 coordinates
 * using the Haversine formula.
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const rLat1 = toRadians(lat1);
  const rLat2 = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_METERS * c);
}

export function getConfiguredOffices(config?: OfficeGeofenceConfig | null): OfficeLocation[] {
  const cfg = config ?? DEFAULT_OFFICE_GEOFENCE;
  if (Array.isArray(cfg.offices) && cfg.offices.length > 0) {
    return cfg.offices;
  }
  return [
    {
      id: "office-hq",
      name: cfg.officeName || DEFAULT_OFFICE_GEOFENCE.officeName,
      latitude: Number.isFinite(cfg.latitude) ? cfg.latitude : DEFAULT_OFFICE_GEOFENCE.latitude,
      longitude: Number.isFinite(cfg.longitude) ? cfg.longitude : DEFAULT_OFFICE_GEOFENCE.longitude,
      radiusMeters: Number.isFinite(cfg.radiusMeters)
        ? cfg.radiusMeters
        : DEFAULT_OFFICE_GEOFENCE.radiusMeters,
      enabled: true,
    },
  ];
}

export interface GeofenceEvaluation {
  distanceMeters: number;
  radiusMeters: number;
  allowed: boolean;
  status: GeofenceStatus;
  officeId: string;
  officeName: string;
}

/**
 * Evaluates user coordinates against all enabled office locations.
 * Approves punch-in if the employee is inside ANY enabled office radius,
 * returning the closest matching office (or the nearest office if out of bounds).
 */
export function evaluateGeofence(
  userLat: number,
  userLon: number,
  config: OfficeGeofenceConfig,
): GeofenceEvaluation {
  const offices = getConfiguredOffices(config);
  const enabledOffices = offices.filter((o) => o.enabled);
  const candidates = enabledOffices.length > 0 ? enabledOffices : offices;

  const evaluated = candidates.map((office) => {
    const distanceMeters = calculateHaversineDistanceMeters(
      userLat,
      userLon,
      office.latitude,
      office.longitude,
    );
    return {
      office,
      distanceMeters,
      inside: distanceMeters <= office.radiusMeters,
    };
  });

  evaluated.sort((a, b) => a.distanceMeters - b.distanceMeters);
  const nearest = evaluated[0] ?? {
    office: {
      id: "office-hq",
      name: config.officeName || "SACE Headquarters",
      latitude: config.latitude,
      longitude: config.longitude,
      radiusMeters: config.radiusMeters,
      enabled: true,
    },
    distanceMeters: calculateHaversineDistanceMeters(
      userLat,
      userLon,
      config.latitude,
      config.longitude,
    ),
    inside: false,
  };

  if (!config.enabled || enabledOffices.length === 0) {
    return {
      distanceMeters: nearest.distanceMeters,
      radiusMeters: nearest.office.radiusMeters,
      allowed: true,
      status: "Bypassed",
      officeId: nearest.office.id,
      officeName: nearest.office.name,
    };
  }

  const matched = evaluated.find((item) => item.inside);
  if (matched) {
    return {
      distanceMeters: matched.distanceMeters,
      radiusMeters: matched.office.radiusMeters,
      allowed: true,
      status: "Inside Office",
      officeId: matched.office.id,
      officeName: matched.office.name,
    };
  }

  return {
    distanceMeters: nearest.distanceMeters,
    radiusMeters: nearest.office.radiusMeters,
    allowed: false,
    status: "Out of Bounds",
    officeId: nearest.office.id,
    officeName: nearest.office.name,
  };
}

export function parseShiftTimeHHMM(
  hhmm: string | undefined,
  fallback: { hours: number; minutes: number },
): { hours: number; minutes: number } {
  if (!hhmm || typeof hhmm !== "string") return fallback;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return fallback;
  }
  return { hours, minutes };
}

export interface ShiftScheduleResult {
  shiftStartAt: string;
  standardLogoutAt: string;
  requiredLogoutAt: string;
  lateMinutes: number;
}

/**
 * Computes lateness relative to standard shift login time and shifts the
 * required logout time forward by +lateMinutes when late carry-over is active.
 */
export function calculateShiftScheduleForPunchIn(
  punchInDate: Date,
  config?: OfficeGeofenceConfig | null,
): ShiftScheduleResult {
  const cfg = config ?? DEFAULT_OFFICE_GEOFENCE;
  const startParts = parseShiftTimeHHMM(cfg.shiftStartTime, { hours: 9, minutes: 30 });
  const endParts = parseShiftTimeHHMM(cfg.shiftEndTime, { hours: 18, minutes: 30 });

  const shiftStart = new Date(punchInDate);
  shiftStart.setHours(startParts.hours, startParts.minutes, 0, 0);

  const standardLogout = new Date(punchInDate);
  standardLogout.setHours(endParts.hours, endParts.minutes, 0, 0);
  if (standardLogout.getTime() <= shiftStart.getTime()) {
    standardLogout.setDate(standardLogout.getDate() + 1);
  }

  const diffMs = punchInDate.getTime() - shiftStart.getTime();
  const lateMinutes = diffMs > 60_000 ? Math.floor(diffMs / 60_000) : 0;
  const carryoverActive = cfg.lateCarryoverEnabled !== false;

  const requiredLogout =
    carryoverActive && lateMinutes > 0
      ? new Date(standardLogout.getTime() + lateMinutes * 60_000)
      : standardLogout;

  return {
    shiftStartAt: shiftStart.toISOString(),
    standardLogoutAt: standardLogout.toISOString(),
    requiredLogoutAt: requiredLogout.toISOString(),
    lateMinutes,
  };
}

export interface LogoutConstraint {
  lateMinutes: number;
  standardLogoutAt: string | null;
  requiredLogoutAt: string | null;
  remainingMs: number;
  blocked: boolean;
}

export function getEffectiveLogoutConstraint(
  record: AttendanceRecord | undefined,
  config?: OfficeGeofenceConfig | null,
  nowMs = Date.now(),
): LogoutConstraint {
  const cfg = config ?? DEFAULT_OFFICE_GEOFENCE;
  if (!record?.punchIn || record.punchOut) {
    return {
      lateMinutes: 0,
      standardLogoutAt: null,
      requiredLogoutAt: null,
      remainingMs: 0,
      blocked: false,
    };
  }

  const punchDate = new Date(record.punchIn);
  if (Number.isNaN(punchDate.getTime())) {
    return {
      lateMinutes: 0,
      standardLogoutAt: null,
      requiredLogoutAt: null,
      remainingMs: 0,
      blocked: false,
    };
  }

  const schedule = calculateShiftScheduleForPunchIn(punchDate, cfg);
  const carryoverActive = cfg.lateCarryoverEnabled !== false;
  const lateMinutes =
    typeof record.lateMinutes === "number" ? record.lateMinutes : schedule.lateMinutes;
  const requiredIso =
    record.requiredLogoutAt ??
    (carryoverActive && lateMinutes > 0
      ? new Date(new Date(schedule.standardLogoutAt).getTime() + lateMinutes * 60_000).toISOString()
      : schedule.standardLogoutAt);

  const requiredMs = new Date(requiredIso).getTime();
  const remainingMs = Math.max(0, requiredMs - nowMs);
  const blocked = carryoverActive && lateMinutes > 0 && remainingMs > 0;

  return {
    lateMinutes,
    standardLogoutAt: schedule.standardLogoutAt,
    requiredLogoutAt: requiredIso,
    remainingMs,
    blocked,
  };
}

export function formatShiftTime12h(hhmm?: string): string {
  const { hours, minutes } = parseShiftTimeHHMM(hhmm, { hours: 9, minutes: 30 });
  const suffix = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export function formatMinutesDuration(totalMinutes: number): string {
  if (totalMinutes <= 0) return "0m";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export interface CapturedCoordinates {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

/**
 * Requests high-accuracy GPS coordinates via browser Geolocation API with clear
 * user-facing guidance when permission is blocked, unavailable, or times out.
 */
export function requestCurrentPosition(
  options: PositionOptions = { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
): Promise<CapturedCoordinates> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      reject(new Error("Geolocation is not supported by this browser or device."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
          accuracyMeters: Math.round(position.coords.accuracy ?? 0),
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(
            new Error(
              "Location permission is blocked. Please allow location access in your browser site settings and try again.",
            ),
          );
          return;
        }
        if (err.code === err.POSITION_UNAVAILABLE) {
          reject(
            new Error(
              "Unable to determine your GPS location. Ensure device location services / GPS are enabled.",
            ),
          );
          return;
        }
        if (err.code === err.TIMEOUT) {
          reject(
            new Error(
              "Location request timed out. Move to an area with clearer GPS/Wi-Fi signal and retry.",
            ),
          );
          return;
        }
        reject(new Error(err.message || "Failed to acquire current GPS coordinates."));
      },
      options,
    );
  });
}

export function formatDistanceMeters(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${meters} m`;
}
