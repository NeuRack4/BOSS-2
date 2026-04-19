import { Header } from "@/components/layout/Header";
import { ChatOverlay } from "@/components/chat/ChatOverlay";
import { ChatProvider } from "@/components/chat/ChatContext";
import { BriefingLoader } from "@/components/chat/BriefingLoader";
import { FilterProvider } from "@/components/canvas/FilterContext";
import { FlowCanvas } from "@/components/canvas/FlowCanvas";
import { FloatingFilterPanel } from "@/components/canvas/FloatingFilterPanel";

export default function DashboardPage() {
  return (
    <ChatProvider>
      <FilterProvider>
        <div className="flex h-screen flex-col overflow-hidden">
          <Header />
          <div className="relative flex flex-1 overflow-hidden">
            <FlowCanvas />
            <FloatingFilterPanel />
          </div>
          <ChatOverlay />
          <BriefingLoader />
        </div>
      </FilterProvider>
    </ChatProvider>
  );
}
