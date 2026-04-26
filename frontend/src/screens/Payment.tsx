import { Link, useLocation } from 'react-router-dom';

export default function Payment() {
  const loc = useLocation();
  const plan = (loc.state as any)?.plan || '套餐';

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-3 mb-3">v1.0</div>
        <h1 className="text-3xl font-bold mb-3 tracking-tight">支付通道即将开放</h1>
        <p className="text-ink-2 mb-8">
          当前为内测期间，请联系客服获取 <span className="font-semibold text-ink">{plan}</span> 额度
        </p>

        <div className="bg-surface border border-border rounded-xl p-6 mb-6">
          <div className="w-32 h-32 bg-surface-2 border border-border rounded-lg mx-auto mb-3 flex items-center justify-center text-ink-3 text-xs">
            [客服微信 QR]
          </div>
          <div className="font-mono text-sm text-ink">
            微信：<span className="font-bold">tokenboss_admin</span>
          </div>
        </div>

        <Link to="/dashboard" className="text-sm text-ink-2">← 返回控制台</Link>
      </div>
    </div>
  );
}
