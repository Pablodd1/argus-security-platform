import "@/lib/logger";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { TRPCProvider } from "@/providers/trpc";
import App from "./App";
import "./styles/kit.css";
import "./styles/app.css";
import "./styles/console.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <App />
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
);
