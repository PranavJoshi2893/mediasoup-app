"use client";
import { useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Hls from "hls.js";

export default function WatchPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const params = useParams();
  const channelId =
    typeof params.channelId === "string"
      ? params.channelId
      : Array.isArray(params.channelId)
      ? params.channelId[0]
      : "";

  useEffect(() => {
    if (!channelId || !videoRef.current) return;

    const hlsUrl = `http://localhost:3001/hls/${channelId}/index.m3u8`;
    let hls: Hls | null = null;

    if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS support (Safari, iOS)
      videoRef.current.src = hlsUrl;
    } else if (Hls.isSupported()) {
      // Most browsers: use hls.js
      hls = new Hls({
        liveSyncDurationCount: 1, // Only buffer 1 segment for live sync (default is 3)
        maxLiveSyncPlaybackRate: 2.0, // Allow player to play up to 2x speed to catch up if needed
        lowLatencyMode: true, // Use low latency mode (if using LL-HLS, optional for classic HLS)
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(videoRef.current);
    } else {
      alert("Your browser does not support HLS.");
    }

    return () => {
      if (hls) hls.destroy();
    };
  }, [channelId]);

  return (
    <div style={{ padding: 32 }}>
      <h2>Live Stream</h2>
      <video
        ref={videoRef}
        controls
        autoPlay
        playsInline
        style={{
          width: "90vw",
          maxWidth: 900,
          borderRadius: 12,
          background: "#222",
        }}
      />
      <p>
        {channelId
          ? "Watching channel: " + channelId
          : "No channel ID found in URL"}
      </p>
    </div>
  );
}
