package com.freeosc.studio;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "StageOscUdp")
public class StageOscUdpPlugin extends Plugin {

    private final ExecutorService txExecutor = Executors.newSingleThreadExecutor();
    private DatagramSocket txSocket;
    private String cachedHost = "";
    private InetAddress cachedAddress = null;

    private DatagramSocket rxSocket;
    private Thread rxThread;
    private volatile boolean rxRunning = false;
    private int currentRxPort = -1;

    @Override
    public void load() {
        try {
            txSocket = new DatagramSocket();
        } catch (Exception ignored) {}
    }

    private byte[] encodeOscString(String str) {
        byte[] bytes = str.getBytes(StandardCharsets.UTF_8);
        int pad = 4 - (bytes.length % 4);
        byte[] out = new byte[bytes.length + pad];
        System.arraycopy(bytes, 0, out, 0, bytes.length);
        return out;
    }

    private byte[] buildOscPacket(String address, JSArray args) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream(64);
        out.write(encodeOscString(address));

        StringBuilder tags = new StringBuilder(",");
        ByteArrayOutputStream argStream = new ByteArrayOutputStream(32);

        if (args != null) {
            for (int i = 0; i < args.length(); i++) {
                JSONObject arg = args.getJSONObject(i);
                String type = arg.optString("type", "f");
                if ("i".equals(type)) {
                    tags.append('i');
                    int val = (int) Math.round(arg.optDouble("value", 0));
                    argStream.write(ByteBuffer.allocate(4).putInt(val).array());
                } else if ("f".equals(type)) {
                    tags.append('f');
                    float val = (float) arg.optDouble("value", 0.0);
                    argStream.write(ByteBuffer.allocate(4).putFloat(val).array());
                } else if ("s".equals(type)) {
                    tags.append('s');
                    argStream.write(encodeOscString(arg.optString("value", "")));
                }
            }
        }

        out.write(encodeOscString(tags.toString()));
        out.write(argStream.toByteArray());
        return out.toByteArray();
    }

    @PluginMethod
    public void send(PluginCall call) {
        final String host = call.getString("host");
        final Integer port = call.getInt("port");
        final String address = call.getString("address");
        final JSArray args = call.getArray("args", new JSArray());
        call.resolve();

        if (host == null || port == null || address == null) return;

        txExecutor.execute(() -> {
            try {
                if (txSocket == null || txSocket.isClosed()) {
                    txSocket = new DatagramSocket();
                }
                if (!host.equals(cachedHost) || cachedAddress == null) {
                    cachedAddress = InetAddress.getByName(host);
                    cachedHost = host;
                }
                byte[] data = buildOscPacket(address, args);
                DatagramPacket packet = new DatagramPacket(data, data.length, cachedAddress, port);
                txSocket.send(packet);
            } catch (Exception ignored) {}
        });
    }

    @PluginMethod
    public void configureRX(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        int port = call.getInt("port", 9000);

        if (!enabled) {
            stopRx();
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("listening", false);
            call.resolve(ret);
            return;
        }

        if (rxRunning && currentRxPort == port) {
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("listening", true);
            call.resolve(ret);
            return;
        }

        stopRx();
        try {
            rxSocket = new DatagramSocket(null);
            rxSocket.setReuseAddress(true);
            rxSocket.bind(new InetSocketAddress(port));
            rxRunning = true;
            currentRxPort = port;

            rxThread = new Thread(() -> {
                byte[] buf = new byte[2048];
                while (rxRunning && rxSocket != null && !rxSocket.isClosed()) {
                    try {
                        DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                        rxSocket.receive(pkt);
                        JSArray parsed = new JSArray();
                        parseOscBytes(Arrays.copyOf(pkt.getData(), pkt.getLength()), parsed);
                        if (parsed.length() > 0) {
                            JSObject ev = new JSObject();
                            ev.put("packets", parsed);
                            notifyListeners("oscRx", ev);
                        }
                    } catch (Exception ignored) {}
                }
            });
            rxThread.setDaemon(true);
            rxThread.start();

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("listening", true);
            call.resolve(ret);
        } catch (Exception e) {
            stopRx();
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    private void parseOscBytes(byte[] buf, JSArray out) {
        if (buf == null || buf.length < 4) return;
        String head = new String(buf, 0, Math.min(7, buf.length), StandardCharsets.UTF_8);
        if (buf.length >= 16 && "#bundle".equals(head)) {
            int offset = 16;
            while (offset + 4 <= buf.length) {
                int size = ByteBuffer.wrap(buf, offset, 4).getInt();
                offset += 4;
                if (size <= 0 || offset + size > buf.length) break;
                parseOscBytes(Arrays.copyOfRange(buf, offset, offset + size), out);
                offset += size;
            }
            return;
        }
        if (buf[0] != '/') return;

        int endAddr = 0;
        while (endAddr < buf.length && buf[endAddr] != 0) endAddr++;
        String address = new String(buf, 0, endAddr, StandardCharsets.UTF_8);
        int tagStart = (endAddr + 4) & ~3;
        if (tagStart >= buf.length) return;

        int endTag = tagStart;
        while (endTag < buf.length && buf[endTag] != 0) endTag++;
        String tags = new String(buf, tagStart, endTag - tagStart, StandardCharsets.UTF_8);
        int offset = (endTag + 4) & ~3;

        JSArray args = new JSArray();
        if (tags.startsWith(",")) {
            try {
                for (int i = 1; i < tags.length(); i++) {
                    char t = tags.charAt(i);
                    if (t == 'f' && offset + 4 <= buf.length) {
                        args.put(ByteBuffer.wrap(buf, offset, 4).getFloat());
                        offset += 4;
                    } else if (t == 'i' && offset + 4 <= buf.length) {
                        args.put(ByteBuffer.wrap(buf, offset, 4).getInt());
                        offset += 4;
                    } else if (t == 'T') {
                        args.put(1);
                    } else if (t == 'F') {
                        args.put(0);
                    }
                }
            } catch (org.json.JSONException e) {
                // Ignore
            }
        }
        JSObject msg = new JSObject();
        msg.put("address", address);
        msg.put("args", args);
        out.put(msg);
    }

    @PluginMethod
    public void getLocalIPs(PluginCall call) {
        JSArray ips = new JSArray();
        try {
            Enumeration<NetworkInterface> nets = NetworkInterface.getNetworkInterfaces();
            while (nets.hasMoreElements()) {
                NetworkInterface ni = nets.nextElement();
                if (ni.isLoopback() || !ni.isUp()) continue;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (addr instanceof Inet4Address) {
                        ips.put(ni.getName() + ": " + addr.getHostAddress());
                    }
                }
            }
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("ips", ips);
        call.resolve(ret);
    }

    private void stopRx() {
        rxRunning = false;
        currentRxPort = -1;
        if (rxSocket != null) {
            try { rxSocket.close(); } catch (Exception ignored) {}
            rxSocket = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopRx();
        if (txSocket != null) {
            try { txSocket.close(); } catch (Exception ignored) {}
        }
        txExecutor.shutdownNow();
    }
}