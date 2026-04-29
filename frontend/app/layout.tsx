import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700", "900"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BOSS",
  description: "소상공인 자율 운영 AI 플랫폼",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
  return (
    <html
      lang="ko"
      className={`${roboto.variable} ${robotoMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <Script id="ngrok-fetch-patch" strategy="beforeInteractive">{`
(function(){
  var base="${apiUrl}";
  if(!base)return;
  var orig=window.fetch;
  window.fetch=function(url,opts){
    if(typeof url==="string"&&url.startsWith(base)){
      var h=new Headers(opts&&opts.headers||{});
      h.set("ngrok-skip-browser-warning","true");
      opts=Object.assign({},opts,{headers:h});
    }
    return orig.call(this,url,opts);
  };
})();
`}</Script>
      <body className="min-h-full flex flex-col bg-[#f2e9d5]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
