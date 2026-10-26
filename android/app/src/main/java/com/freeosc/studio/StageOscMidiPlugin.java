package com.freeosc.studio;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiInputPort;
import android.media.midi.MidiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.UUID;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "StageOscMidi",
    permissions = {
        @Permission(
            alias = "ble",
            strings = {
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT
            }
        )
    }
)
public class StageOscMidiPlugin extends Plugin {

    private static final UUID MIDI_SERVICE_UUID = UUID.fromString("03B80E5A-EDE8-4B33-A751-6CE34EC4C700");
    private static final UUID MIDI_CHAR_UUID = UUID.fromString("7772E5DB-3868-4112-A1A9-F2669D106BF3");
    private static final UUID CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private final ExecutorService midiExecutor = Executors.newSingleThreadExecutor();
    private MidiManager midiManager;
    private MidiDevice activeUsbDevice;
    private MidiInputPort activeInputPort;
    private String activePortKey = "";
    private String activePortName = "";

    private BluetoothManager btManager;
    private BluetoothAdapter btAdapter;
    private BluetoothLeAdvertiser bleAdvertiser;
    private BluetoothGattServer gattServer;
    private BluetoothGattCharacteristic midiCharacteristic;
    private final CopyOnWriteArraySet<BluetoothDevice> bleSubscribers = new CopyOnWriteArraySet<>();
    private volatile boolean bleAdvertising = false;

    private final MidiManager.DeviceCallback usbHotplugCallback = new MidiManager.DeviceCallback() {
        @Override
        public void onDeviceAdded(MidiDeviceInfo device) {
            notifyPortsUpdated();
        }

        @Override
        public void onDeviceRemoved(MidiDeviceInfo device) {
            if (activeUsbDevice != null && activeUsbDevice.getInfo().getId() == device.getId()) {
                closeActiveUsbPort();
            }
            notifyPortsUpdated();
        }
    };

    @Override
    public void load() {
        Context ctx = getContext();
        if (ctx.getPackageManager().hasSystemFeature(PackageManager.FEATURE_MIDI)) {
            midiManager = (MidiManager) ctx.getSystemService(Context.MIDI_SERVICE);
            if (midiManager != null) {
                midiManager.registerDeviceCallback(usbHotplugCallback, new Handler(Looper.getMainLooper()));
            }
        }
        btManager = (BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
        if (btManager != null) {
            btAdapter = btManager.getAdapter();
        }
    }

    private void notifyPortsUpdated() {
        JSObject ev = new JSObject();
        ev.put("ports", collectAvailablePorts());
        ev.put("activePortKey", activePortKey);
        notifyListeners("midiPortsChanged", ev);
    }

    private void notifyBleStatus(String message) {
        JSObject ev = new JSObject();
        ev.put("advertising", bleAdvertising);
        ev.put("connectedCount", bleSubscribers.size());
        ev.put("message", message);
        notifyListeners("bleStatusChanged", ev);
    }

    private JSArray collectAvailablePorts() {
        JSArray list = new JSArray();
        if (midiManager == null) return list;

        MidiDeviceInfo[] infos = midiManager.getDevices();
        for (MidiDeviceInfo info : infos) {
            int inCount = info.getInputPortCount();
            if (inCount <= 0) continue;

            Bundle props = info.getProperties();
            String rawName = props.getString(MidiDeviceInfo.PROPERTY_NAME, "");
            String product = props.getString(MidiDeviceInfo.PROPERTY_PRODUCT, "");
            String mfg = props.getString(MidiDeviceInfo.PROPERTY_MANUFACTURER, "");
            int type = info.getType();

            String baseLabel = !rawName.isEmpty() ? rawName : (!product.isEmpty() ? product : "Puerto MIDI " + info.getId());
            boolean isUsbPeripheral = (type == MidiDeviceInfo.TYPE_USB) &&
                (baseLabel.toLowerCase().contains("peripheral") || "android".equalsIgnoreCase(mfg));

            String prefix = isUsbPeripheral
                ? "[USB-C a PC] "
                : (type == MidiDeviceInfo.TYPE_USB ? "[USB] " : (type == MidiDeviceInfo.TYPE_BLUETOOTH ? "[BT] " : ""));

            for (int p = 0; p < inCount; p++) {
                JSObject item = new JSObject();
                String key = info.getId() + ":" + p;
                String portSuffix = inCount > 1 ? " (Puerto " + (p + 1) + ")" : "";
                item.put("id", key);
                item.put("name", prefix + baseLabel + portSuffix);
                item.put("manufacturer", mfg);
                item.put("isUsbPeripheral", isUsbPeripheral);
                list.put(item);
            }
        }
        return list;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject res = new JSObject();
        res.put("ports", collectAvailablePorts());
        res.put("activePortKey", activePortKey);
        res.put("activePortName", activePortName);
        res.put("bleAdvertising", bleAdvertising);
        res.put("bleConnectedCount", bleSubscribers.size());
        call.resolve(res);
    }

    @PluginMethod
    public void selectPort(PluginCall call) {
        String portKey = call.getString("portId", "");
        if (portKey == null || portKey.isEmpty() || midiManager == null) {
            closeActiveUsbPort();
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("connected", false);
            call.resolve(res);
            return;
        }

        String[] parts = portKey.split(":");
        if (parts.length != 2) {
            call.reject("Formato de puerto inválido");
            return;
        }

        final int targetId = Integer.parseInt(parts[0]);
        final int targetPortIndex = Integer.parseInt(parts[1]);

        MidiDeviceInfo targetInfo = null;
        for (MidiDeviceInfo info : midiManager.getDevices()) {
            if (info.getId() == targetId) {
                targetInfo = info;
                break;
            }
        }

        if (targetInfo == null) {
            closeActiveUsbPort();
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("connected", false);
            call.resolve(res);
            return;
        }

        closeActiveUsbPort();
        final Bundle props = targetInfo.getProperties();
        final String label = props.getString(MidiDeviceInfo.PROPERTY_NAME, "Puerto USB MIDI");

        midiManager.openDevice(targetInfo, device -> {
            if (device == null) {
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("connected", false);
                call.resolve(res);
                return;
            }
            MidiInputPort inPort = device.openInputPort(targetPortIndex);
            if (inPort == null) {
                try { device.close(); } catch (Exception ignored) {}
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("connected", false);
                res.put("error", "El puerto USB MIDI está ocupado por otra app");
                call.resolve(res);
                return;
            }

            activeUsbDevice = device;
            activeInputPort = inPort;
            activePortKey = portKey;
            activePortName = label;

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("connected", true);
            res.put("name", label);
            call.resolve(res);
        }, new Handler(Looper.getMainLooper()));
    }

    private void closeActiveUsbPort() {
        activePortKey = "";
        activePortName = "";
        if (activeInputPort != null) {
            try { activeInputPort.close(); } catch (Exception ignored) {}
            activeInputPort = null;
        }
        if (activeUsbDevice != null) {
            try { activeUsbDevice.close(); } catch (Exception ignored) {}
            activeUsbDevice = null;
        }
    }

    // --- Servidor Periférico Bluetooth LE MIDI ---
    @PluginMethod
    public void setBlePeripheral(PluginCall call) {
        boolean enable = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (!enable) {
            stopBleServer();
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("advertising", false);
            call.resolve(res);
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("ble") != PermissionState.GRANTED) {
            requestPermissionForAlias("ble", call, "onBlePermissionResult");
            return;
        }

        startBleServer(call);
    }

    @PermissionCallback
    private void onBlePermissionResult(PluginCall call) {
        if (getPermissionState("ble") == PermissionState.GRANTED) {
            startBleServer(call);
        } else {
            call.reject("Debes autorizar el permiso de Dispositivos Cercanos (Bluetooth)");
        }
    }

    @SuppressWarnings("MissingPermission")
    private void startBleServer(PluginCall call) {
        if (btAdapter == null || !btAdapter.isEnabled()) {
            call.reject("Enciende el Bluetooth de tu tablet/celular primero");
            return;
        }
        if (!btAdapter.isMultipleAdvertisementSupported()) {
            call.reject("Este hardware Android no soporta modo periférico BLE");
            return;
        }
        if (bleAdvertising) {
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("advertising", true);
            call.resolve(res);
            return;
        }

        try {
            gattServer = btManager.openGattServer(getContext(), gattCallback);
            if (gattServer == null) {
                call.reject("No se pudo abrir el servidor GATT Bluetooth");
                return;
            }

            BluetoothGattService midiService = new BluetoothGattService(
                MIDI_SERVICE_UUID,
                BluetoothGattService.SERVICE_TYPE_PRIMARY
            );

            midiCharacteristic = new BluetoothGattCharacteristic(
                MIDI_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_READ
                    | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE
                    | BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_READ
                    | BluetoothGattCharacteristic.PERMISSION_WRITE
            );

            BluetoothGattDescriptor cccd = new BluetoothGattDescriptor(
                CCCD_UUID,
                BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE
            );
            midiCharacteristic.addDescriptor(cccd);
            midiService.addCharacteristic(midiCharacteristic);
            gattServer.addService(midiService);

            bleAdvertiser = btAdapter.getBluetoothLeAdvertiser();
            AdvertiseSettings settings = new AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .setConnectable(true)
                .build();

            // Paquete primario ligero (solo UUID de 128 bits para no exceder 31 bytes)
            AdvertiseData primaryData = new AdvertiseData.Builder()
                .setIncludeDeviceName(false)
                .addServiceUuid(new ParcelUuid(MIDI_SERVICE_UUID))
                .build();

            // Nombre del dispositivo en Scan Response
            AdvertiseData scanResponse = new AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .build();

            bleAdvertiser.startAdvertising(settings, primaryData, scanResponse, new AdvertiseCallback() {
                @Override
                public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                    bleAdvertising = true;
                    notifyBleStatus("Visible por Bluetooth MIDI (esperando conexión desde tu laptop)");
                    JSObject res = new JSObject();
                    res.put("ok", true);
                    res.put("advertising", true);
                    call.resolve(res);
                }

                @Override
                public void onStartFailure(int errorCode) {
                    bleAdvertising = false;
                    stopBleServer();
                    call.reject("Fallo al anunciar Bluetooth MIDI (Código " + errorCode + ")");
                }
            });
        } catch (Exception e) {
            stopBleServer();
            call.reject("Error iniciando BLE-MIDI: " + e.getMessage());
        }
    }

    private final BluetoothGattServerCallback gattCallback = new BluetoothGattServerCallback() {
        @Override
        @SuppressWarnings("MissingPermission")
        public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                bleSubscribers.add(device);
                String devName = device.getName() != null ? device.getName() : device.getAddress();
                notifyBleStatus("✓ Conectado por Bluetooth MIDI a: " + devName);
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                bleSubscribers.remove(device);
                notifyBleStatus(bleAdvertising
                    ? "Visible por Bluetooth MIDI (esperando conexión)"
                    : "Bluetooth MIDI desactivado");
            }
        }

        @Override
        @SuppressWarnings("MissingPermission")
        public void onCharacteristicReadRequest(BluetoothDevice device, int requestId, int offset, BluetoothGattCharacteristic characteristic) {
            if (gattServer != null) {
                gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, new byte[0]);
            }
        }

        @Override
        @SuppressWarnings("MissingPermission")
        public void onDescriptorReadRequest(BluetoothDevice device, int requestId, int offset, BluetoothGattDescriptor descriptor) {
            if (gattServer != null) {
                gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            }
        }

        @Override
        @SuppressWarnings("MissingPermission")
        public void onDescriptorWriteRequest(BluetoothDevice device, int requestId, BluetoothGattDescriptor descriptor, boolean preparedWrite, boolean responseNeeded, int offset, byte[] value) {
            bleSubscribers.add(device);
            if (responseNeeded && gattServer != null) {
                gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null);
            }
            String devName = device.getName() != null ? device.getName() : device.getAddress();
            notifyBleStatus("✓ Suscrito en DAW: " + devName);
        }

        @Override
        @SuppressWarnings("MissingPermission")
        public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId, BluetoothGattCharacteristic characteristic, boolean preparedWrite, boolean responseNeeded, int offset, byte[] value) {
            if (responseNeeded && gattServer != null) {
                gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null);
            }
        }
    };

    @SuppressWarnings("MissingPermission")
    private void stopBleServer() {
        bleAdvertising = false;
        bleSubscribers.clear();
        if (bleAdvertiser != null) {
            try { bleAdvertiser.stopAdvertising(new AdvertiseCallback() {}); } catch (Exception ignored) {}
            bleAdvertiser = null;
        }
        if (gattServer != null) {
            try { gattServer.close(); } catch (Exception ignored) {}
            gattServer = null;
        }
        notifyBleStatus("Bluetooth MIDI desactivado");
    }

    @PluginMethod
    public void send(PluginCall call) {
        JSArray arr = call.getArray("bytes");
        call.resolve();
        if (arr == null || arr.length() == 0) return;

        final byte[] rawMidi = new byte[arr.length()];
        try {
            for (int i = 0; i < arr.length(); i++) {
                rawMidi[i] = (byte) (arr.getInt(i) & 0xFF);
            }
        } catch (Exception e) {
            return;
        }

        midiExecutor.execute(() -> {
            // 1. Envío por cable USB-C (MidiManager)
            if (activeInputPort != null) {
                try {
                    activeInputPort.send(rawMidi, 0, rawMidi.length);
                } catch (Exception ignored) {}
            }

            // 2. Envío inalámbrico BLE-MIDI a la laptop conectada
            if (bleAdvertising && gattServer != null && midiCharacteristic != null && !bleSubscribers.isEmpty()) {
                long ms = System.currentTimeMillis() & 0x1FFF;
                byte[] blePacket = new byte[2 + rawMidi.length];
                blePacket[0] = (byte) (0x80 | ((ms >> 7) & 0x3F));
                blePacket[1] = (byte) (0x80 | (ms & 0x7F));
                System.arraycopy(rawMidi, 0, blePacket, 2, rawMidi.length);

                notifyBlePacket(blePacket);
            }
        });
    }

    @SuppressWarnings({"MissingPermission", "deprecation"})
    private void notifyBlePacket(byte[] blePacket) {
        for (BluetoothDevice dev : bleSubscribers) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    gattServer.notifyCharacteristicChanged(dev, midiCharacteristic, false, blePacket);
                } else {
                    midiCharacteristic.setValue(blePacket);
                    gattServer.notifyCharacteristicChanged(dev, midiCharacteristic, false);
                }
            } catch (Exception ignored) {}
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (midiManager != null) {
            try { midiManager.unregisterDeviceCallback(usbHotplugCallback); } catch (Exception ignored) {}
        }
        closeActiveUsbPort();
        stopBleServer();
        midiExecutor.shutdownNow();
    }
}