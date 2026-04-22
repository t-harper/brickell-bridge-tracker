export interface DeviceRegistration {
  deviceId: string;
  apnsToken: string | null;
  bundleId: string;
  appVersion: string;
  registeredAt: string;
}

export interface ActivityRegistration {
  activityId: string;
  activityPushToken: string;
  startedAt: string;
}

export interface DeviceRecord extends DeviceRegistration {
  pk: "DEVICE";
  sk: string;
  activities: Record<string, ActivityRegistration>;
}
