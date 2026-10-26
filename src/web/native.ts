// Loaded only inside the Android app.
import { CapacitorHttp } from '@capacitor/core';
import { createDeviceBackend } from './deviceBackend.ts';

export const nativeBackend = createDeviceBackend((options) => CapacitorHttp.get(options));
