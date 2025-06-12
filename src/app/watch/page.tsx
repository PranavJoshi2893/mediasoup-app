"use client";
import { useRef, useState, useEffect } from "react";
import Hls from "hls.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function Watch() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [roomId, setRoomId] = useState("");
  const [playing, setPlaying] = useState(false);
  const [hlsError, setHlsError] = useState<string | null>(null);
  const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);

  useEffect(() => {
    // Cleanup on unmount or room change
    return () => {
      if (hlsInstance) {
        hlsInstance.destroy();
        setHlsInstance(null);
      }
      if (videoRef.current) videoRef.current.src = "";
    };
    // eslint-disable-next-line
  }, [roomId]);

  const startWatching = () => {
    setHlsError(null);
    if (!roomId) {
      setHlsError("Enter a Room ID.");
      return;
    }
    const url = `http://localhost:3001/hls/${roomId}/index.m3u8`;

    if (videoRef.current) {
      // Native HLS support (Safari)
      if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
        videoRef.current.src = url;
        videoRef.current.play().catch(() => setHlsError("Autoplay failed"));
      } else if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(videoRef.current);
        setHlsInstance(hls);

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            setHlsError("HLS playback error.");
            hls.destroy();
            setHlsInstance(null);
          }
        });

        videoRef.current.play().catch(() => setHlsError("Autoplay failed"));
      } else {
        setHlsError("This browser does not support HLS.");
      }
      setPlaying(true);
    }
  };

  const stopWatching = () => {
    setPlaying(false);
    setRoomId("");
    setHlsError(null);
    if (hlsInstance) {
      hlsInstance.destroy();
      setHlsInstance(null);
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = "";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 flex flex-col items-center justify-center px-2">
      <Card className="w-full max-w-[96vw] mx-auto border-none shadow-2xl bg-black/80 backdrop-blur-lg">
        <CardHeader>
          <CardTitle className="text-center text-3xl font-extrabold tracking-tight text-white drop-shadow mb-4">
            Mediasoup Live Watch
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Video Area */}
          <div className="flex flex-col items-center justify-center w-full">
            <div className="relative w-full flex justify-center">
              <video
                ref={videoRef}
                playsInline
                autoPlay
                controls
                className="rounded-2xl bg-black shadow-xl border border-gray-700 transition-all w-full max-w-[1280px] aspect-video"
                style={{
                  background: "#000",
                  objectFit: "contain",
                  minHeight: "220px",
                  maxHeight: "72vh",
                }}
              />
              {/* Error overlay */}
              {hlsError && (
                <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center bg-black/60 rounded-2xl">
                  <span className="text-xl text-red-400 font-semibold px-4">{hlsError}</span>
                </div>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col items-center mt-8 gap-3 w-full">
            <div className="flex gap-2 w-full max-w-sm mx-auto justify-center">
              <Input
                className="w-32 md:w-48"
                placeholder="Room ID"
                value={roomId}
                onChange={e => setRoomId(e.target.value)}
                disabled={playing}
                inputMode="text"
                maxLength={32}
                autoFocus
              />
              <Button
                onClick={startWatching}
                disabled={playing || !roomId}
                className="font-semibold px-6"
              >
                Watch
              </Button>
            </div>
            {playing && (
              <div className="flex flex-col items-center mt-4 w-full">
                <span className="font-medium text-base mb-1 text-white/80">
                  Watching Room:{" "}
                  <span className="font-mono text-blue-400 bg-black/50 px-2 py-1 rounded">
                    {roomId}
                  </span>
                </span>
                <Button
                  onClick={stopWatching}
                  variant="destructive"
                  size="sm"
                  className="mt-2"
                >
                  Stop Watching
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      {/* Extra spacing on mobile */}
      <div className="h-8" />
    </div>
  );
}

export default Watch;
