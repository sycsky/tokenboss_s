import ServiceNotice from './screens/ServiceNotice';
import { ServicePauseBanner } from './components/ServicePauseBanner';
import { ServicePauseFooter } from './components/ServicePauseFooter';
import { SERVICE_PAUSE_ENABLED } from './lib/servicePause';
import { Routes, Route } from 'react-router-dom';
import Landing from './screens/Landing';
import Login from './screens/Login';
import MagicLogin from './screens/MagicLogin';
import Register from './screens/Register';
import VerifyEmail from './screens/VerifyEmail';
import OAuthCallback from './screens/OAuthCallback';
import OnboardWelcome from './screens/OnboardWelcome';
import OnboardInstall from './screens/OnboardInstall';
import OnboardSuccess from './screens/OnboardSuccess';
import Dashboard from './screens/Dashboard';
import UsageHistory from './screens/UsageHistory';
import Settings from './screens/Settings';
import Plans from './screens/Plans';
import Primitive from './screens/Primitive';
import Payment from './screens/Payment';
import OrderStatus from './screens/OrderStatus';
import ManualConfigPC from './screens/ManualConfigPC';
import ProtocolOpenAICompat from './screens/docs/ProtocolOpenAICompat';
import ProtocolAnthropicShim from './screens/docs/ProtocolAnthropicShim';
import ProtocolGeminiProxy from './screens/docs/ProtocolGeminiProxy';
import Topup from './screens/Topup';
import Legal from './screens/Legal';
import AdminLogin from './screens/AdminLogin';
import AdminUsers from './screens/AdminUsers';
import AdminUserDetail from './screens/AdminUserDetail';
import { RequireAuth } from './components/RequireAuth';
import { RequireAdmin } from './components/RequireAdmin';
import { CurrencyProvider } from './lib/currency';

export default function App() {
  return (
    <CurrencyProvider>
    <ServicePauseBanner />
    <Routes>
      <Route path="/service-notice" element={<ServiceNotice />} />
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={SERVICE_PAUSE_ENABLED ? <ServiceNotice /> : <Login />} />
      <Route path="/login/magic" element={SERVICE_PAUSE_ENABLED ? <ServiceNotice /> : <MagicLogin />} />
      <Route path="/register" element={SERVICE_PAUSE_ENABLED ? <ServiceNotice /> : <Register />} />
      <Route path="/verify-email" element={SERVICE_PAUSE_ENABLED ? <ServiceNotice /> : <VerifyEmail />} />
      <Route path="/oauth/callback" element={SERVICE_PAUSE_ENABLED ? <ServiceNotice /> : <OAuthCallback />} />

      <Route path="/onboard/welcome" element={SERVICE_PAUSE_ENABLED ? <ServiceNotice /> : <RequireAuth><OnboardWelcome /></RequireAuth>} />
      <Route path="/onboard/install" element={SERVICE_PAUSE_ENABLED ? <ServiceNotice /> : <RequireAuth><OnboardInstall /></RequireAuth>} />
      <Route path="/onboard/success" element={SERVICE_PAUSE_ENABLED ? <ServiceNotice /> : <RequireAuth><OnboardSuccess /></RequireAuth>} />

      <Route path="/console" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/console/history" element={<RequireAuth><UsageHistory /></RequireAuth>} />
      <Route path="/console/account" element={<RequireAuth><Settings /></RequireAuth>} />

      <Route path="/pricing" element={<Plans />} />
      <Route path="/primitive" element={<Primitive />} />

      {/* Public policy pages — required by MoR / payment-channel review. */}
      <Route path="/terms" element={<Legal doc="terms" />} />
      <Route path="/privacy" element={<Legal doc="privacy" />} />
      <Route path="/refund" element={<Legal doc="refund" />} />
      <Route path="/billing/pay" element={SERVICE_PAUSE_ENABLED ? <ServiceNotice /> : <RequireAuth><Payment /></RequireAuth>} />
      <Route path="/billing/topup" element={SERVICE_PAUSE_ENABLED ? <ServiceNotice /> : <RequireAuth><Topup /></RequireAuth>} />
      <Route path="/billing/orders/:id" element={<RequireAuth><OrderStatus /></RequireAuth>} />
      <Route path="/billing/success" element={<RequireAuth><OrderStatus /></RequireAuth>} />

      <Route path="/install/manual" element={<ManualConfigPC />} />

      {/* Public protocol docs — extended reading from /install/manual's
          ProtocolFamilyLinks. No auth required (these are reference docs
          a user may hit before signing up). */}
      <Route path="/docs/protocols/openai-compat" element={<ProtocolOpenAICompat />} />
      <Route path="/docs/protocols/anthropic-shim" element={<ProtocolAnthropicShim />} />
      <Route path="/docs/protocols/gemini-proxy" element={<ProtocolGeminiProxy />} />

      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin/users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
      <Route path="/admin/users/:userId" element={<RequireAdmin><AdminUserDetail /></RequireAdmin>} />
    </Routes>
    <ServicePauseFooter />
    </CurrencyProvider>
  );
}
