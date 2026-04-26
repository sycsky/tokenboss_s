import { Link } from 'react-router-dom';

export default function OnboardSuccess() {
  return (
    <div className="min-h-screen bg-bg p-6 flex flex-col">
      <div className="max-w-md mx-auto w-full mt-16 text-center">
        <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-accent mb-4">已激活</div>
        <h1 className="text-5xl font-extrabold mb-3 tracking-tight">搞定</h1>
        <p className="text-ink-2 text-sm mb-10">你的 Agent 钱包已就绪，回到 Agent 直接对话即可</p>

        <div className="bg-surface border border-border rounded-2xl p-5 mb-8 text-left">
          <div className="flex items-center justify-between py-2 border-b border-hairline">
            <span className="text-ink-3 font-mono text-[11px] uppercase tracking-wider">试用额度</span>
            <span className="text-ink font-mono text-base font-bold">$10</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-ink-3 font-mono text-[11px] uppercase tracking-wider">有效期</span>
            <span className="text-ink font-mono text-base font-bold">24 小时</span>
          </div>
        </div>

        <Link
          to="/dashboard"
          className="block w-full py-3 bg-accent text-white font-semibold rounded-lg mb-3"
        >
          看控制台 →
        </Link>
        <a className="block text-sm text-ink-2">回到 Agent 继续</a>
      </div>
    </div>
  );
}
