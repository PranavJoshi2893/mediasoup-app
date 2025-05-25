"use client";
import { useRef, useState } from "react";
import styles from "./page.module.css";
import * as mediasoupClient from "mediasoup-client";
import type { RtpCapabilities, TransportOptions } from "mediasoup-client/types";

let device: mediasoupClient.types.Device;

async function generateChannelId() {
    return "ch_" + Math.random().toString(36).slice(2, 10);
}

function Stream() {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);
    const channelIdRef = useRef("");
    const transportRef = useRef<any>(null); // Store for closing/cleanup if needed
    const [channelId, setChannelId] = useState("");

    const onStartStream = async () => {
        try {
            if (!channelIdRef.current) {
                const id = await generateChannelId();
                channelIdRef.current = id;
                setChannelId(id);
            }

            await connectWebSocket();

            if (!wsRef.current) throw new Error('WebSocket reference missing after connection!');

            const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            streamRef.current = mediaStream;
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
            }

            wsRef.current.send(JSON.stringify({
                type: "getRouterRtpCapabilities",
                data: { channelId: channelIdRef.current }
            }));


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
        if (wsRef.current) {
            wsRef.current.close(1000, "Stopped by user");
            wsRef.current = null;
        }
        // Optionally also close transport
        if (transportRef.current) {
            transportRef.current.close();
            transportRef.current = null;
        }
        setIsStreaming(false);
        channelIdRef.current = ""; // Reset for next stream
    };

    const connectWebSocket = (): Promise<void> => {
        return new Promise((resolve, reject) => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return resolve();
            const ws = new WebSocket(`ws://localhost:3001/ws`);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log("WebSocket connected");
                resolve();
            };

            ws.onmessage = async (msg: MessageEvent) => {
                const { type, data } = JSON.parse(msg.data);

                if (!wsRef.current) throw new Error('WebSocket reference missing after connection!');

                switch (type) {
                    case "routerCapabilities":
                        device = new mediasoupClient.Device();
                        await device.load({ routerRtpCapabilities: data as RtpCapabilities });
                        wsRef.current.send(JSON.stringify({
                            type: "createProducerTransport",
                            data: { channelId: channelIdRef.current }
                        }));
                        break;
                    case "producerTransportCreated":
                        await createSendTransport(data);
                        break;
                    case "producerConnected":
                        // No action needed: handled in the connect callback
                        break;
                    case "produced":
                        // id returned by server in response to produce request
                        if (pendingProduceCallback.current) {
                            pendingProduceCallback.current({ id: data.id });
                            pendingProduceCallback.current = null;
                        }
                        break;
                    case "error":
                        alert("Error from server: " + data);
                        break;
                    default:
                        break;
                }
            };

            ws.onerror = (err) => {
                console.error("WebSocket error:", err);
                reject(err);
            };
            ws.onclose = () => console.log("WebSocket closed");
        });
    };

    // Store the produce callback so you can resolve it later from a ws message
    const pendingProduceCallback = useRef<((data: { id: string }) => void) | null>(null);

    const createSendTransport = async (params: TransportOptions) => {
        const transport = device.createSendTransport(params);
        transportRef.current = transport; // For cleanup on stop

        transport.on("connect", ({ dtlsParameters }, callback, errback) => {
            if (!wsRef.current) throw new Error('WebSocket reference missing after connection!');
            wsRef.current.send(
                JSON.stringify({
                    type: "connectProducerTransport",
                    data: { dtlsParameters, channelId: channelIdRef.current },
                })
            );
            callback(); // Call immediately for simple cases; for strict ordering, wait for server "producerConnected"
        });

        transport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
            if (!wsRef.current) throw new Error('WebSocket reference missing after connection!');
            wsRef.current.send(
                JSON.stringify({
                    type: "produce",
                    data: { kind, rtpParameters, channelId: channelIdRef.current },
                })
            );
            // Save callback, to be called from the ws.onmessage handler when "produced" arrives:
            pendingProduceCallback.current = callback;
            // If error, you could also call errback with an error reason.
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
