"use client";
import { useRef, useState, useCallback, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";
import type { Device, Transport, Consumer, RtpParameters, IceParameters, IceCandidate, DtlsParameters, RtpCapabilities } from "mediasoup-client/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ---- Type Definitions ----
type KindType = "audio" | "video" | undefined;

type ProducersListResponse = {
    producers: { userId: string; producerId: string; kind: string }[];
    error?: string;
};

type TransportParams = {
    id: string;
    iceParameters: IceParameters;
    iceCandidates: IceCandidate[];
    dtlsParameters: DtlsParameters;
    error?: string;
};

type ConsumeResponse = {
    id: string;
    producerId: string;
    kind: KindType;
    rtpParameters: RtpParameters;
    error?: string;
};

/**
 * Stream component:
 * Handles room creation/join, producing, consuming, subscribing to remote streams.
 * Main concern: always fully cleanup the remote video stream/element/transport on stop or disconnect.
 */
function Stream() {
    // --- Media and transport refs (imperative, for lifetime management) ---
    const videoRef = useRef<HTMLVideoElement | null>(null);           // Local video element
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);     // Remote video element
    const streamRef = useRef<MediaStream | null>(null);               // Local media stream
    const socketRef = useRef<Socket | null>(null);                    // Socket connection
    const deviceRef = useRef<Device | null>(null);                    // Mediasoup Device (per-connection)
    const sendTransportRef = useRef<Transport | null>(null);          // Sending WebRTC transport (my media)
    const recvTransportRef = useRef<Transport | null>(null);          // Receiving WebRTC transport (remote)

    // --- State for UI and main logic ---
    const [roomIdInput, setRoomIdInput] = useState<string>("");
    const [myRoomId, setMyRoomId] = useState<string>("");
    const [connected, setConnected] = useState<boolean>(false);
    const [deviceLoaded, setDeviceLoaded] = useState<boolean>(false);
    const [hasRemoteProducers, setHasRemoteProducers] = useState<boolean>(false);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [isProducing, setIsProducing] = useState(false);

    const clearRemoteVideo = useCallback(() => {
        if (remoteStream) {
            remoteStream.getTracks().forEach(track => {
                try { track.stop(); } catch { }
                remoteStream.removeTrack(track);
            });
            setRemoteStream(null);
        }
        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
            if (typeof remoteVideoRef.current.load === "function") {
                remoteVideoRef.current.load();
            }
        }
        if (recvTransportRef.current) {
            recvTransportRef.current.close();
            recvTransportRef.current = null;
        }
    }, [remoteStream]);

    // ----- Fix: Add clearRemoteVideo to deps -----
    const checkRemoteProducers = useCallback(() => {
        const socket = socketRef.current;
        if (!socket || !myRoomId) return;
        socket.emit("listProducers", { roomId: myRoomId }, (res: ProducersListResponse) => {
            if (res && Array.isArray(res.producers)) {
                const remote = res.producers.some(
                    (p) => p.userId !== socket.id
                );
                setHasRemoteProducers(remote);
                if (!remote) clearRemoteVideo();
            } else {
                setHasRemoteProducers(false);
                clearRemoteVideo();
            }
        });
    }, [myRoomId, clearRemoteVideo]); // Added clearRemoteVideo!

    const setupSocketListeners = useCallback((socket: Socket) => {
        socket.off("newProducer").on("newProducer", checkRemoteProducers);
        socket.off("roomProducersChanged").on("roomProducersChanged", checkRemoteProducers);

        socket.off("disconnect").on("disconnect", () => {
            setConnected(false);
            setMyRoomId("");
            deviceRef.current = null;
            setDeviceLoaded(false);
            setRemoteStream(null);
            setHasRemoteProducers(false);
            if (sendTransportRef.current) {
                sendTransportRef.current.close();
                sendTransportRef.current = null;
            }
            clearRemoteVideo();
        });

        socket.off("connect_error").on("connect_error", (err: { message: string }) => {
            setConnected(false);
            setMyRoomId("");
            setDeviceLoaded(false);
            setHasRemoteProducers(false);
            alert("WebSocket error: " + err.message);
        });
    }, [checkRemoteProducers, clearRemoteVideo]); // Added clearRemoteVideo!

    useEffect(() => {
        if (socketRef.current) {
            setupSocketListeners(socketRef.current);
        }
    }, [setupSocketListeners]);

    // ---- Remove 'any' ----
    const loadDevice = async (rtpCapabilities: RtpCapabilities) => {
        if (!deviceRef.current || !deviceRef.current.loaded) {
            const device = new mediasoupClient.Device();
            await device.load({ routerRtpCapabilities: rtpCapabilities });
            deviceRef.current = device;
            setDeviceLoaded(true);
        }
    };

    const createRoom = () => {
        if (socketRef.current && socketRef.current.connected) return;
        const socket = io("ws://localhost:3001", { path: "/ws" });
        // const socket = io("wss://sync.pranavjoshi.dev", { path: "/ws" });
        socketRef.current = socket;

        socket.on("connect", () => {
            socket.emit("createRoom", {}, (res: { roomId?: string }) => {
                if (res.roomId) {
                    setMyRoomId(res.roomId);
                    setConnected(true);
                    setRoomIdInput("");
                    socket.emit(
                        "getRouterRtpCapabilities",
                        { roomId: res.roomId },
                        async (resp: { rtpCapabilities?: unknown; error?: string }) => {
                            if (resp.error) alert(resp.error);
                            else if (resp.rtpCapabilities) await loadDevice(resp.rtpCapabilities);
                            checkRemoteProducers();
                        }
                    );
                    socket.emit("logProducers", { roomId: res.roomId }, (result: any) => {
                        console.log("logProducers after createRoom:", result);
                    });
                }
            });
        });
    };

    const joinRoom = () => {
        if (!roomIdInput) {
            alert("Enter a room ID to join.");
            return;
        }
        if (socketRef.current && socketRef.current.connected) return;
        const socket = io("ws://localhost:3001", { path: "/ws" });
        // const socket = io("wss://sync.pranavjoshi.dev", { path: "/ws" });
        socketRef.current = socket;

        socket.on("connect", () => {
            socket.emit("joinRoom", { roomId: roomIdInput }, (res: { roomId?: string; error?: string }) => {
                if (res.error) {
                    alert(res.error);
                    setConnected(false);
                    setMyRoomId("");
                    setRoomIdInput("");
                    setDeviceLoaded(false);
                    setHasRemoteProducers(false);
                    socket.disconnect();
                    socketRef.current = null;
                } else if (res.roomId) {
                    setMyRoomId(res.roomId);
                    setConnected(true);
                    setRoomIdInput("");
                    socket.emit(
                        "getRouterRtpCapabilities",
                        { roomId: res.roomId },
                        async (resp: { rtpCapabilities?: unknown; error?: string }) => {
                            if (resp.error) alert(resp.error);
                            else if (resp.rtpCapabilities) await loadDevice(resp.rtpCapabilities);
                            checkRemoteProducers();
                        }
                    );
                    socket.emit("logProducers", { roomId: res.roomId }, (result: any) => {
                        console.log("logProducers after joinRoom:", result);
                    });
                }
            });
        });
    };

    // --- Producer/Consumer Transport helpers ---
    const createProducerTransport = (): Promise<TransportParams> => {
        return new Promise((resolve, reject) => {
            if (!socketRef.current || !myRoomId) return reject("Not connected or no room.");
            socketRef.current.emit("createProducerTransport", { roomId: myRoomId }, (params: TransportParams) => {
                if (params.error) {
                    alert(params.error);
                    return reject(params.error);
                }
                resolve(params);
            });
        });
    };

    const createConsumerTransport = (): Promise<TransportParams> => {
        return new Promise((resolve, reject) => {
            if (!socketRef.current || !myRoomId) return reject("Not connected or no room.");
            socketRef.current.emit("createConsumerTransport", { roomId: myRoomId }, (params: TransportParams) => {
                if (params.error) {
                    alert(params.error);
                    return reject(params.error);
                }
                resolve(params);
            });
        });
    };

    /**
     * Consumes a given remote producer (video/audio).
     * - Always closes previous recvTransport before creating a new one.
     * - Creates a new MediaStream for each subscription (avoids ghost tracks).
     * - If already subscribed, old video is cleared before new arrives.
     */
    const setupConsumer = async (producerId: string) => {
        if (!deviceRef.current || !socketRef.current || !myRoomId) {
            alert("Not connected or no room.");
            return;
        }

        // Only clear and re-create transport once for all tracks
        if (!recvTransportRef.current) {
            const params = await createConsumerTransport();
            const recvTransport = deviceRef.current.createRecvTransport(params);
            recvTransportRef.current = recvTransport;

            recvTransport.on("connect", ({ dtlsParameters }, callback) => {
                if (!socketRef.current) return;
                socketRef.current.emit("connectConsumerTransport", { dtlsParameters, roomId: myRoomId }, () => {
                    callback();
                });
            });

            // Set up empty MediaStream initially
            setRemoteStream(new MediaStream());
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = new MediaStream();
            }
        }

        socketRef.current.emit(
            "consume",
            {
                producerId,
                roomId: myRoomId,
                rtpCapabilities: deviceRef.current.rtpCapabilities,
            },
            async (res: ConsumeResponse) => {
                if (res.error) {
                    alert(res.error);
                    return;
                }
                const consumer: Consumer = await recvTransportRef.current!.consume({
                    id: res.id,
                    producerId: res.producerId,
                    kind: res.kind,
                    rtpParameters: res.rtpParameters,
                });
                // Add to MediaStream for each remote track
                setRemoteStream(prev => {
                    const ms = prev || new MediaStream();
                    ms.addTrack(consumer.track);
                    if (remoteVideoRef.current) {
                        remoteVideoRef.current.srcObject = ms;
                    }
                    return ms;
                });
            }
        );
    };

    /**
     * Start (produce) my local stream.
     * - Closes any old send transport.
     * - Produces all local tracks to the server.
     */
    const startStream = async () => {
        if (isProducing) return; // Prevent double trigger
        setIsProducing(true);

        try {
            if (!connected) {
                alert("Join or create a room first!");
                return;
            }
            if (!deviceRef.current) {
                alert("Mediasoup Device not loaded!");
                return;
            }
            if (sendTransportRef.current) {
                sendTransportRef.current.close();
                sendTransportRef.current = null;
            }
            const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            streamRef.current = mediaStream;
            if (videoRef.current) videoRef.current.srcObject = mediaStream;

            const params = await createProducerTransport();
            const transport = deviceRef.current.createSendTransport(params);
            sendTransportRef.current = transport;

            transport.on("connect", ({ dtlsParameters }, callback) => {
                if (!socketRef.current) return;
                socketRef.current.emit("connectProducerTransport", { dtlsParameters, roomId: myRoomId }, () => {
                    callback();
                });
            });

            transport.on("produce", ({ kind, rtpParameters }, callback) => {
                if (!socketRef.current) return;
                socketRef.current.emit("produce", { kind, rtpParameters, roomId: myRoomId }, ({ id }: { id: string }) => {
                    callback({ id });
                });
            });

            // Produce each track by kind
            for (const track of mediaStream.getTracks()) {
                await transport.produce({ track });
            }
        } catch (err: any) {
            alert("Failed to start stream: " + err.message);
        } finally {
            setIsProducing(false);
        }


    };

    /**
     * Stop (un-produce) my local stream.
     * - Notifies backend to remove my producer.
     * - Stops local media, closes send transport, clears local video.
     * - Does NOT affect remote video/transport.
     */
    const stopStream = () => {
        if (socketRef.current && myRoomId) {
            socketRef.current.emit("stopProducing", { roomId: myRoomId });
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        if (sendTransportRef.current) {
            sendTransportRef.current.close();
            sendTransportRef.current = null;
        }
        checkRemoteProducers();
    };

    /**
     * Disconnect and leave the room, cleanup everything (local, remote, transports, state).
     */
    const disconnectSocket = () => {
        if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
            setConnected(false);
            setMyRoomId("");
            setRoomIdInput("");
            deviceRef.current = null;
            setDeviceLoaded(false);
            setHasRemoteProducers(false);
            if (sendTransportRef.current) {
                sendTransportRef.current.close();
                sendTransportRef.current = null;
            }
            clearRemoteVideo();
        }
    };

    /**
     * Subscribe to all remote producers.
     * - Calls setupConsumer for each remote producer that's not me.
     */
    const subscribeToProducers = () => {
        if (!socketRef.current || !myRoomId || !deviceLoaded || !hasRemoteProducers) {
            alert("Not connected, no room/device, or no remote producers.");
            return;
        }
        // Clear remote video before subscribing to new set
        clearRemoteVideo();
        socketRef.current.emit("listProducers", { roomId: myRoomId }, (res: ProducersListResponse) => {
            if (res.error) {
                alert(res.error);
                return;
            }
            if (!Array.isArray(res.producers) || res.producers.length === 0) {
                alert("No remote producers found in the room.");
                setHasRemoteProducers(false);
                return;
            }
            let found = false;
            for (const { userId, producerId } of res.producers) {
                if (userId !== socketRef.current?.id) {
                    found = true;
                    setupConsumer(producerId);
                }
            }
            setHasRemoteProducers(found);
        });
    };

    // --- UI ---
    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 py-10 px-2">
            <Card className="w-full max-w-2xl mx-auto shadow-lg border-none">
                <CardHeader>
                    <CardTitle className="text-center text-2xl">Mediasoup Stream Room</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col md:flex-row gap-6 justify-center items-center w-full">
                        <div className="flex flex-col items-center w-full">
                            <span className="font-semibold mb-2">Local Video</span>
                            <video
                                ref={videoRef}
                                playsInline
                                autoPlay
                                muted
                                className="rounded-lg bg-black w-60 aspect-video shadow"
                            />
                        </div>
                        <div className="flex flex-col items-center w-full">
                            <span className="font-semibold mb-2">Remote Video</span>
                            <video
                                ref={remoteVideoRef}
                                playsInline
                                autoPlay
                                className="rounded-lg bg-black w-60 aspect-video shadow"
                            />
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-3 justify-center mt-8">
                        <Button onClick={startStream} disabled={!connected || isProducing} size="lg">
                            Start Stream
                        </Button>
                        <Button onClick={stopStream} variant="secondary" size="lg">
                            Stop Stream
                        </Button>
                    </div>
                    <div className="flex flex-col items-center mt-10 gap-3">
                        <div className="flex gap-2 w-full justify-center">
                            <Button onClick={createRoom} disabled={connected} size="sm">
                                Create Room
                            </Button>
                            <span className="self-center opacity-70">or</span>
                            <Input
                                className="w-32"
                                placeholder="Room ID"
                                value={roomIdInput}
                                onChange={e => setRoomIdInput(e.target.value)}
                                disabled={connected}
                            />
                            <Button onClick={joinRoom} disabled={connected} size="sm">
                                Join Room
                            </Button>
                        </div>
                        {myRoomId && (
                            <div className="flex flex-col items-center mt-2 w-full">
                                <span className="font-medium text-sm mb-1">
                                    Connected to Room: <span className="font-mono text-blue-500">{myRoomId}</span>
                                </span>
                                <div className="flex gap-2 mt-1">
                                    <Button onClick={disconnectSocket} variant="destructive" size="sm">
                                        Leave Room
                                    </Button>
                                    <Button
                                        onClick={subscribeToProducers}
                                        disabled={!connected || !deviceLoaded || !myRoomId || !hasRemoteProducers}
                                        size="sm"
                                    >
                                        Subscribe
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

export default Stream;
