'use client';

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  const streamPageRedirect = () => {
    router.push('/stream')
  }

  const watchPageRedirect = () => {
    router.push('/watch')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <Card className="w-full max-w-sm shadow-md">
        <CardHeader>
          <CardTitle className="text-center">Select a Page</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <Button size="lg" onClick={streamPageRedirect}>
              Redirect to Stream
            </Button>
            <Button size="lg" variant="outline" onClick={watchPageRedirect}>
              Redirect to Watch
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
