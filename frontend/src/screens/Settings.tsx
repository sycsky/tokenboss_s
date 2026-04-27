import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { api, type BucketRecord } from '../lib/api';
import { AppNav } from '../components/AppNav';
import { SectionHeader } from '../components/SectionHeader';

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';

export default function Settings() {
  const { user, logout } = useAuth();
  const [stats, setStats] = useState({ consumed: 0, calls: 0 });
  const [bucket, setBucket] = useState<BucketRecord | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);

  useEffect(() => {
    api.getUsage({}).then((r) => setStats(r.totals));
    api.getBuckets().then((r) => setBucket((r.buckets || []).find((b) => b.skuType.startsWith('plan_')) ?? null));
    api.me().then((r) => setCreatedAt(r.user?.createdAt ?? null));
  }, []);

  const planName =
    bucket?.skuType?.replace('plan_', '').replace(/^./, (c: string) => c.toUpperCase()) ?? '无';
  const daysLeft = bucket?.expiresAt
    ? Math.ceil((new Date(bucket.expiresAt).getTime() - Date.now()) / 86400e3)
    : 0;

  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="account" />

      <main className="max-w-[820px] mx-auto px-5 sm:px-9 pt-6">
        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] mb-2 font-bold">
          ACCOUNT · 账户
        </div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-tight leading-none mb-10">
          你的钱包，你的设置。
        </h1>

        {/* 01 Account */}
        <SectionHeader num="01" cn="账户" en="Account" size="lg" className="mb-4" />
        <div className={`${card} p-6 mb-9`}>
          <Row
            label="邮箱"
            value={
              <span className="font-mono text-[13.5px] font-semibold text-ink break-all">
                {user?.email}
                <Link
                  to="/console/account"
                  className="ml-2 font-sans text-accent text-[11.5px] font-semibold underline underline-offset-2"
                >
                  需修改 → 联系客服
                </Link>
              </span>
            }
          />
          <Row
            label="邮箱状态"
            value={
              user?.emailVerified ? (
                <span className="font-mono text-[12px] font-bold uppercase tracking-wider px-2 py-0.5 bg-lime-stamp text-lime-stamp-ink border-2 border-ink rounded">
                  已验证
                </span>
              ) : (
                <span className="font-mono text-[12px] font-bold uppercase tracking-wider px-2 py-0.5 bg-yellow-stamp text-yellow-stamp-ink border-2 border-ink rounded">
                  待验证
                </span>
              )
            }
          />
          <Row
            label="当前套餐"
            value={
              <span className="text-[14px] font-bold text-ink">
                {planName}
                {daysLeft > 0 && (
                  <span className="font-mono text-[11.5px] text-[#A89A8D] ml-2 font-medium">
                    还 {daysLeft} 天
                  </span>
                )}
              </span>
            }
          />
          <Row
            label="注册时间"
            value={
              <span className="font-mono text-[12.5px] text-[#6B5E52]">
                {createdAt
                  ? new Date(createdAt).toLocaleDateString('zh-CN', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    })
                  : '—'}
              </span>
            }
            last
          />
        </div>

        {/* 02 Usage */}
        <SectionHeader num="02" cn="用量" en="Usage" size="lg" className="mb-4" />
        <div className={`${card} p-7 mb-9`}>
          <div className="grid grid-cols-2 gap-0">
            <div className="border-r-2 border-ink/10 pr-5">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-2">
                总消耗
              </div>
              <div className="font-mono text-[28px] font-bold leading-none text-ink">
                ${(stats.consumed ?? 0).toFixed(2)}
              </div>
              <div className="font-mono text-[10.5px] text-[#A89A8D] mt-1.5">自注册以来</div>
            </div>
            <div className="pl-5">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-2">
                总调用
              </div>
              <div className="font-mono text-[28px] font-bold leading-none text-ink">
                {stats.calls ?? 0}
              </div>
              <div className="font-mono text-[10.5px] text-[#A89A8D] mt-1.5">次</div>
            </div>
          </div>
        </div>

        {/* 03 Actions */}
        <SectionHeader num="03" cn="操作" en="Actions" size="lg" className="mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-12">
          <ActionCard
            title="联系客服"
            hint="微信 / 工单 · 工作日 9-21"
          />
          <ActionCard
            title="退出登录"
            hint="下次需重新输入邮箱与密码"
            danger
            onClick={logout}
          />
        </div>
      </main>
    </div>
  );
}

function Row({
  label,
  value,
  last = false,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-3 ${last ? '' : 'border-b-2 border-ink/10'}`}>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold flex-shrink-0">
        {label}
      </span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function ActionCard({
  title,
  hint,
  danger = false,
  onClick,
}: {
  title: string;
  hint: string;
  danger?: boolean;
  onClick?: () => void;
}) {
  const common =
    'block w-full text-left px-5 py-4 bg-white border-2 border-ink rounded-md ' +
    'shadow-[3px_3px_0_0_#1C1917] ' +
    'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
    'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
    'transition-all cursor-pointer';
  const titleCls = `text-[14px] font-bold ${danger ? 'text-red-ink' : 'text-ink'}`;
  return (
    <button onClick={onClick} className={common}>
      <div className={titleCls}>{title}</div>
      <div className="font-mono text-[11px] text-[#A89A8D] mt-0.5">{hint}</div>
    </button>
  );
}
