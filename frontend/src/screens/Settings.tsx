import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { SectionHeader } from '../components/SectionHeader';

export default function Settings() {
  const { user, logout } = useAuth();
  const [stats, setStats] = useState({ consumed: 0, calls: 0 });
  const [bucket, setBucket] = useState<any>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);

  useEffect(() => {
    api.getUsage({}).then((r: any) => setStats(r.totals));
    api.getBuckets().then((r: any) => setBucket((r.buckets || []).find((b: any) => b.skuType.startsWith('plan_'))));
    api.me().then((r: any) => setCreatedAt(r.user?.createdAt ?? null));
  }, []);

  const planName = bucket?.skuType?.replace('plan_', '').replace(/^./, (c: string) => c.toUpperCase()) ?? '无';
  const daysLeft = bucket?.expiresAt ? Math.ceil((new Date(bucket.expiresAt).getTime() - Date.now()) / 86400e3) : 0;

  return (
    <div className="min-h-screen bg-bg pb-12">
      <nav className="px-9 py-4 flex items-center justify-between border-b border-border max-w-[1200px] mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-accent rounded-md flex items-center justify-center text-white font-mono text-[10px] font-bold">TB</div>
          <span className="font-bold">TokenBoss</span>
        </div>
        <div className="flex gap-6 text-[13px] text-ink-2">
          <Link to="/dashboard" className="text-ink font-semibold">控制台</Link>
          <Link to="/pricing">套餐</Link>
        </div>
        <div className="text-[12.5px] text-ink-2">{user?.email}</div>
      </nav>

      <main className="max-w-[760px] mx-auto px-6 py-12">
        <div className="font-mono text-[11px] text-ink-3 mb-4">
          <Link to="/dashboard" className="hover:text-ink">控制台</Link>
          <span className="mx-2 text-ink-4">/</span>
          <span>账户</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-12">账户</h1>

        <SectionHeader num="01" cn="账户" en="Account" size="lg" className="mb-5" />
        <div className="bg-surface border border-border rounded-xl p-7 mb-9">
          <div className="flex justify-between py-3 border-b border-hairline">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3 font-semibold">邮箱</span>
            <span className="font-mono text-sm font-semibold">{user?.email} <a className="text-accent text-xs ml-2">需修改 → 联系客服</a></span>
          </div>
          <div className="flex justify-between py-3 border-b border-hairline">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3 font-semibold">当前套餐</span>
            <span className="text-sm font-semibold">{planName} {daysLeft > 0 && <span className="font-mono text-xs text-ink-3 ml-2">还 {daysLeft} 天</span>}</span>
          </div>
          <div className="flex justify-between py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3 font-semibold">注册时间</span>
            <span className="font-mono text-xs text-ink-3">
              {createdAt ? new Date(createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—'}
            </span>
          </div>
        </div>

        <SectionHeader num="02" cn="用量" en="Usage" size="lg" className="mb-5" />
        <div className="bg-surface border border-border rounded-xl p-7 mb-9">
          <div className="grid grid-cols-2 gap-0">
            <div className="border-r border-hairline pr-4">
              <div className="font-mono text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold mb-1.5">总消耗</div>
              <div className="font-mono text-2xl font-bold leading-none">${(stats.consumed ?? 0).toFixed(2)}</div>
              <div className="font-mono text-[10.5px] text-ink-3 mt-1">自注册以来</div>
            </div>
            <div className="pl-4">
              <div className="font-mono text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold mb-1.5">总调用</div>
              <div className="font-mono text-2xl font-bold leading-none">{stats.calls ?? 0}</div>
              <div className="font-mono text-[10.5px] text-ink-3 mt-1">次</div>
            </div>
          </div>
        </div>

        <SectionHeader num="03" cn="操作" en="Actions" size="lg" className="mb-5" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <a className="block bg-surface border border-border rounded-xl p-5 cursor-pointer hover:border-ink-3">
            <div className="text-sm font-semibold">联系客服</div>
            <div className="font-mono text-[11px] text-ink-3 mt-0.5">微信 / 工单 · 工作日 9-21</div>
          </a>
          <button onClick={logout} className="text-left bg-surface border border-border rounded-xl p-5 cursor-pointer hover:border-red-ink">
            <div className="text-sm font-semibold text-red-ink">退出登录</div>
            <div className="font-mono text-[11px] text-ink-3 mt-0.5">下次需重新验证邮箱</div>
          </button>
        </div>
      </main>
    </div>
  );
}
