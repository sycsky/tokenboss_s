import { Routes, Route } from 'react-router-dom';
import Landing from './screens/Landing';
import Login from './screens/Login';
import MagicLogin from './screens/MagicLogin';
import Register from './screens/Register';
import OnboardWelcome from './screens/OnboardWelcome';
import OnboardInstall from './screens/OnboardInstall';
import OnboardSuccess from './screens/OnboardSuccess';
import Dashboard from './screens/Dashboard';
import UsageHistory from './screens/UsageHistory';
import Settings from './screens/Settings';
import Plans from './screens/Plans';
import Primitive from './screens/Primitive';
import Payment from './screens/Payment';
import ManualConfigPC from './screens/ManualConfigPC';
import { RequireAuth } from './components/RequireAuth';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/login/magic" element={<MagicLogin />} />
      <Route path="/register" element={<Register />} />

      <Route path="/onboard/welcome" element={<RequireAuth><OnboardWelcome /></RequireAuth>} />
      <Route path="/onboard/install" element={<RequireAuth><OnboardInstall /></RequireAuth>} />
      <Route path="/onboard/success" element={<RequireAuth><OnboardSuccess /></RequireAuth>} />

      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/dashboard/history" element={<RequireAuth><UsageHistory /></RequireAuth>} />
      <Route path="/dashboard/account" element={<RequireAuth><Settings /></RequireAuth>} />

      <Route path="/pricing" element={<Plans />} />
      <Route path="/primitive" element={<Primitive />} />
      <Route path="/billing/pay" element={<Payment />} />

      <Route path="/install/manual" element={<ManualConfigPC />} />
    </Routes>
  );
}
