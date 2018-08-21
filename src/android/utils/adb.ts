import * as Debug from 'debug';

import { execFile } from '../../utils/process';

import { SDK } from './sdk';

const debug = Debug('native-run:android:utils:adb');

export interface DeviceProperties {
  [key: string]: string | undefined;
}

export interface Device {
  serial: string;
  state: string; // 'offline' | 'device' | 'no device'
  type: 'emulator' | 'hardware';
  manufacturer: string;
  model: string;
  product: string;
  sdkVersion: string;
  properties: DeviceProperties;
}

const ADB_GETPROP_MAP: ReadonlyMap<string, keyof Device> = new Map<string, keyof Device>([
  ['ro.product.manufacturer', 'manufacturer'],
  ['ro.product.model', 'model'],
  ['ro.product.name', 'product'],
  ['ro.build.version.sdk', 'sdkVersion'],
]);

export async function getDevices(sdk: SDK): Promise<Device[]> {
  const adbBin = `${sdk.platformTools.path}/adb`;
  const args = ['devices', '-l'];
  debug('Invoking adb: %O %O', adbBin, args);

  const { stdout } = await execFile(adbBin, args);

  const devices = parseAdbDevices(stdout);

  await Promise.all(devices.map(async device => {
    const properties = await getDeviceProperties(sdk, device);

    for (const [ prop, deviceProp ] of ADB_GETPROP_MAP.entries()) {
      const value = properties[prop];

      if (value) {
        device[deviceProp] = value;
      }
    }
  }));

  return devices;
}

export async function getDeviceProperties(sdk: SDK, device: Device): Promise<DeviceProperties> {
  const re = /^\[([a-z0-9\.]+)\]: \[(.*)\]$/;
  const adbBin = `${sdk.platformTools.path}/adb`;
  const args = ['-s', device.serial, 'shell', 'getprop'];
  debug('Invoking adb: %O %O', adbBin, args);
  const propAllowList = [...ADB_GETPROP_MAP.keys()];

  const { stdout } = await execFile(adbBin, args);
  const properties: DeviceProperties = {};

  for (const line of stdout.split('\n')) {
    const m = line.match(re);

    if (m) {
      const [ , key, value ] = m;

      if (propAllowList.includes(key)) {
        properties[key] = value;
      }
    }
  }

  return properties;
}

export async function deployApk(sdk: SDK, serial: string, apk: string): Promise<void> {
  const adbBin = `${sdk.platformTools.path}/adb`;
  const args = ['-s', serial, 'install', '-r', '-t', apk];
  debug('Invoking adb: %O %O', adbBin, args);

  await execFile(adbBin, args);
}

export async function startActivity(sdk: SDK, serial: string, packageName: string, activityName: string): Promise<void> {
  const adbBin = `${sdk.platformTools.path}/adb`;
  const args = ['-s', serial, 'shell', 'am', 'start', '-W', '-n', `${packageName}/${activityName}`];
  debug('Invoking adb: %O %O', adbBin, args);

  await execFile(adbBin, args);
}

export function parseAdbDevices(output: string): Device[] {
  const re = /^([\S]+)\s+([a-z\s]+)\s+(.*)$/;
  const lines = output.split('\n');

  const devices: Device[] = [];

  for (const line of lines) {
    if (line && !line.startsWith('List')) {
      const m = line.match(re);

      if (m) {
        const [ , serial, state, description ] = m;
        const properties = description
          .split(/\s+/)
          .map(prop => prop.includes(':') ? prop.split(':') : undefined)
          .filter((kv): kv is [string, string] => typeof kv !== 'undefined' && typeof kv[0] === 'string' && typeof kv[1] === 'string')
          .reduce((acc, [ k, v ]) => {
            if (k && v) {
              acc[k.trim()] = v.trim();
            }

            return acc;
          }, {} as { [key: string]: string; });

        devices.push({
          serial,
          state,
          type: 'usb' in properties ? 'hardware' : 'emulator',
          properties,
          // We might not know these yet
          manufacturer: '',
          model: properties['model'] || '',
          product: '',
          sdkVersion: '',
        });
      } else {
        debug('adb devices output line does not match expected regex: %O', line);
      }
    }
  }

  return devices;
}
