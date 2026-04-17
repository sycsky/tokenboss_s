import { Routes, Route } from "react-router-dom";

import Landing from "./screens/Landing.js";
import LandingVision from "./screens/LandingVision.js";
import OnboardWelcome from "./screens/OnboardWelcome.js";
import OnboardInstall from "./screens/OnboardInstall.js";
import OnboardPairCode from "./screens/OnboardPairCode.js";
import OnboardBind from "./screens/OnboardBind.js";
import OnboardSuccess from "./screens/OnboardSuccess.js";
import LowBalance from "./screens/LowBalance.js";
import BalanceCommand from "./screens/BalanceCommand.js";
import Plans from "./screens/Plans.js";
import Payment from "./screens/Payment.js";
import PaymentSuccess from "./screens/PaymentSuccess.js";
import AddOns from "./screens/AddOns.js";
import AddOnSuccess from "./screens/AddOnSuccess.js";
import Dashboard from "./screens/Dashboard.js";
import UsageHistory from "./screens/UsageHistory.js";
import FlowIndex from "./screens/FlowIndex.js";
import Login from "./screens/Login.js";
import Register from "./screens/Register.js";
import Keys from "./screens/Keys.js";
import { RequireAuth } from "./components/RequireAuth.js";

export default function App() {
  return (
    <Routes>
      {/* Marketing */}
      <Route path="/" element={<Landing />} />
      <Route path="/landing/vision" element={<LandingVision />} />

      {/* Onboarding */}
      <Route path="/onboard/welcome" element={<OnboardWelcome />} />
      <Route path="/onboard/install" element={<OnboardInstall />} />
      <Route path="/onboard/pair-code" element={<OnboardPairCode />} />
      <Route path="/onboard/bind" element={<OnboardBind />} />
      <Route path="/onboard/success" element={<OnboardSuccess />} />

      {/* Chat simulations */}
      <Route path="/chat/low-balance" element={<LowBalance />} />
      <Route path="/chat/balance" element={<BalanceCommand />} />

      {/* Billing */}
      <Route path="/billing/plans" element={<Plans />} />
      <Route path="/billing/pay" element={<Payment />} />
      <Route path="/billing/success" element={<PaymentSuccess />} />
      <Route path="/billing/addons" element={<AddOns />} />
      <Route path="/billing/addon-success" element={<AddOnSuccess />} />

      {/* Auth */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Dashboard (session-gated) */}
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/dashboard/history"
        element={
          <RequireAuth>
            <UsageHistory />
          </RequireAuth>
        }
      />
      <Route
        path="/dashboard/keys"
        element={
          <RequireAuth>
            <Keys />
          </RequireAuth>
        }
      />

      {/* Dev preview */}
      <Route path="/flow" element={<FlowIndex />} />
    </Routes>
  );
}
