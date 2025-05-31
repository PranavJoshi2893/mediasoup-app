"use client";
import { useRef, useState } from "react";
import styles from "./page.module.css";
import * as mediasoupClient from "mediasoup-client";
import { io, Socket } from "socket.io-client";
import type { RtpCapabilities, TransportOptions } from "mediasoup-client/types";

let device: mediasoupClient.types.Device;

async function generateChannelId() {
    return "ch_" + Math.random().toString(36).slice(2, 10);
}

type MediaKind = "audio" | "video";

function Stream() {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const socketRef = useRef<Socket | null>(null);
    const channelIdRef = useRef("");
    const transportRef = useRef<any>(null); // For closing/cleanup
    const [channelId, setChannelId] = useState("");
    const pendingProduceCallback = useRef<((data: { id: string }) => void) | null>(null);

    const onStartStream = async () => {
        try {
            if (!channelIdRef.current) {
                const id = await generateChannelId();
                channelIdRef.current = id;
                setChannelId(id);
            }

            await connectSocketIo();

            if (!socketRef.current) throw new Error('Socket.IO ref missing after connection!');

            const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            streamRef.current = mediaStream;
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
            }

            // Join Room (room = channel)
            socketRef.current.emit("joinRoom", { channelId: channelIdRef.current });

            // Request router RTP caps
            socketRef.current.emit("getRouterRtpCapabilities", { channelId: channelIdRef.current });

            setIsStreaming(true);
        } catch (err) {
            console.error("Failed to start stream:", err);
        }
    };

    const onStopStream = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (videoRef.current) videoRef.current.srcObject = null;
        if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
        }
        if (transportRef.current) {
            transportRef.current.close();
            transportRef.current = null;
        }
        setIsStreaming(false);
        channelIdRef.current = ""; // Reset for next stream
    };

    const connectSocketIo = (): Promise<void> => {
        return new Promise((resolve, reject) => {
            if (socketRef.current && socketRef.current.connected) return resolve();

            const socket = io("ws://localhost:3001", { path: "/ws" });
            socketRef.current = socket;

            socket.on("connect", () => {
                console.log("Socket.IO connected");
                resolve();
            });

            socket.on("routerCapabilities", async ({ data }) => {
                device = new mediasoupClient.Device();
                await device.load({ routerRtpCapabilities: data as RtpCapabilities });
                socket.emit("createProducerTransport", { channelId: channelIdRef.current });
            });

            socket.on("producerTransportCreated", async ({ data }) => {
                await createSendTransport(data);
            });

            socket.on("producerConnected", () => {
                // Optional: callback in "connect" event of transport can be called immediately
            });

            socket.on("produced", (payload) => {
                if (pendingProduceCallback.current) {
                    pendingProduceCallback.current({ id: payload.id });
                    pendingProduceCallback.current = null;
                }
            });

            socket.on("joinedRoom", (payload) => {
                console.log("Joined room:", payload);
            });

            socket.on("error", (err) => {
                alert("Error from server: " + (err.data || err));
            });

            socket.on("disconnect", () => {
                console.log("Socket.IO disconnected");
            });

            socket.on("connect_error", (err) => {
                console.error("Socket.IO error:", err);
                reject(err);
            });
        });
    };

    const createSendTransport = async (params: TransportOptions) => {
        const transport = device.createSendTransport(params);
        transportRef.current = transport;

        transport.on("connect", ({ dtlsParameters }, callback, errback) => {
            if (!socketRef.current) throw new Error('Socket.IO ref missing after connection!');
            socketRef.current.emit("connectProducerTransport", {
                dtlsParameters,
                channelId: channelIdRef.current
            });
            callback(); // Or, if you want to wait for "producerConnected", call only then
        });

        transport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
            if (!socketRef.current) throw new Error('Socket.IO ref missing after connection!');
            socketRef.current.emit("produce", {
                kind: kind as MediaKind,
                rtpParameters,
                channelId: channelIdRef.current
            });
            pendingProduceCallback.current = callback;
        });

        // Start producing tracks!
        if (streamRef.current) {
            for (const track of streamRef.current.getTracks()) {
                await transport.produce({ track });
            }
        }
    };

    return (
        <div className={styles.wrapper}>
            <video className={styles.video} ref={videoRef} playsInline autoPlay muted></video>
            <div className={styles.btn_section}>
                <button onClick={onStartStream} disabled={isStreaming}>Start Stream</button>
                <button onClick={onStopStream} disabled={!isStreaming}>Stop Stream</button>
            </div>
            {isStreaming && channelId && (
                <div style={{ margin: "1rem 0", padding: "1rem", border: "1px solid #ccc", borderRadius: "8px" }}>
                    <b>Share this link:</b>
                    <input
                        style={{ width: "100%", marginTop: "8px" }}
                        readOnly
                        value={`${window.location.origin}/watch/${channelId}`}
                        onFocus={e => e.target.select()}
                    />
                    <button
                        style={{ marginTop: 8 }}
                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/watch/${channelId}`)}
                    >
                        Copy Link
                    </button>
                    <div style={{ marginTop: 8, color: "#888" }}>Send to anyone you want to watch your stream.</div>
                </div>
            )}
        </div>
    );
}

export default Stream;
