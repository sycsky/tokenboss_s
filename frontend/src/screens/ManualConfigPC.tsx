import { Link } from 'react-router-dom';
import { TerminalBlock } from '../components/TerminalBlock';
import { AppNav } from '../components/AppNav';
import { CompatRow, type AgentMark } from '../components/CompatRow';
import openClawIcon from '../assets/agents/openclaw.svg';
import hermesIcon from '../assets/agents/hermes.png';

const AGENTS: AgentMark[] = [
  {
    id: 'oc',
    name: 'OpenClaw',
    className: 'bg-[#0A0807] p-1',
    icon: <img src={openClawIcon} alt="" className="w-full h-full" style={{ imageRendering: 'pixelated' }} />,
  },
  {
    id: 'hm',
    name: 'Hermes Agent',
    className: 'bg-white p-0',
    icon: <img src={hermesIcon} alt="" className="w-full h-full object-cover rounded-lg" />,
  },
];

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';
const codeChip =
  'font-mono text-[12px] text-ink bg-bg border-2 border-ink rounded px-2 py-0.5 break-all';
const codeBlock =
  'font-mono text-[12.5px] text-ink bg-bg border-2 border-ink rounded p-3 break-all leading-relaxed';

export default function ManualConfigPC() {
  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="console" />

      <main className="max-w-[820px] mx-auto px-5 sm:px-9 pt-6">
        {/* Breadcrumb */}
        <div className="font-mono text-[11px] tracking-[0.06em] text-[#A89A8D] mb-4">
          <Link to="/console" className="hover:text-ink transition-colors">控制台</Link>
          <span className="mx-2 text-[#D9CEC2]">/</span>
          <span className="text-ink-2">接入文档</span>
        </div>

        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] mb-2 font-bold">
          INSTALL · 接入文档
        </div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-tight leading-[1.05] mb-3">
          一行咒语，接通你的 Agent。
        </h1>
        <p className="text-[14px] text-text-secondary mb-9 max-w-[540px] leading-relaxed">
          大部分 Agent 都能识别"自然语言安装"——粘一行进终端，Agent 自己拉文档、自己问你要 Key、自己写配置。
          下面也保留了传统的 4 步方式。
        </p>

        {/* 01 · One-liner spell (the recommended path) */}
        <section className="mb-10">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3 flex items-center gap-2">
            <span className="bg-lime-stamp text-lime-stamp-ink border-2 border-ink rounded px-1.5 py-0.5 tracking-[0.12em]">
              推荐
            </span>
            <span>一行咒语</span>
          </div>
          <div className={`${card} p-6`}>
            <p className="text-[13.5px] text-text-secondary mb-4 leading-relaxed">
              在你的 Agent 终端里粘这行——它会自己拉 <span className={codeChip}>skill.md</span> 完成接入。
            </p>
            <TerminalBlock cmd="set up tokenboss.com/skill.md" size="lg" />
            <CompatRow label="已支持" agents={AGENTS} className="mt-4" />
          </div>
        </section>

        {/* 02 · Manual 4-step fallback */}
        <section>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3 flex items-center gap-2">
            <span className="bg-bg-alt text-ink-2 border-2 border-ink rounded px-1.5 py-0.5 tracking-[0.12em]">
              备选
            </span>
            <span>传统 4 步</span>
          </div>
          <div className={`${card} p-6 space-y-5`}>
            <Step
              n="1"
              title="创建一把 API Key"
              body={
                <span>
                  到 <Link to="/console/keys" className="text-accent font-semibold underline underline-offset-2">控制台 / API Keys</Link> 点「+ 创建」。
                  完整 key 只在创建后的弹窗里显示一次，<span className="font-semibold text-ink">立即复制保存</span>。
                </span>
              }
            />
            <Step
              n="2"
              title="设置 Base URL"
              body={
                <div className="space-y-2">
                  <p>把这个地址作为你的 Agent 的 OpenAI 兼容 base URL：</p>
                  <div className={codeBlock}>https://api.tokenboss.com/v1</div>
                </div>
              }
            />
            <Step
              n="3"
              title="设置环境变量"
              body={
                <div className="space-y-2">
                  <p>把刚才复制的 key 写进环境变量（或粘到 Agent 配置的 API Key 字段）：</p>
                  <div className={codeBlock}>{'export TOKENBOSS_API_KEY=tb_live_xxxxxxxx'}</div>
                </div>
              }
            />
            <Step
              n="4"
              title="跑一次测试"
              body={
                <div className="space-y-2">
                  <p>看看 base URL 是否能访问、key 是否生效：</p>
                  <div className={codeBlock}>{'curl -H "Authorization: Bearer $TOKENBOSS_API_KEY" \\\n     https://api.tokenboss.com/v1/models'}</div>
                  <p className="font-mono text-[11px] text-[#A89A8D]">
                    返回带 model 列表的 JSON 即接通成功。回到控制台，你会看到第一条调用记录。
                  </p>
                </div>
              }
              last
            />
          </div>
        </section>

        {/* Footer help line */}
        <div className="mt-10 font-mono text-[11.5px] text-ink-3 max-w-[540px] leading-relaxed">
          接入卡住？发 <span className={codeChip}>tokenboss.com/skill.md</span> 给你的 Agent，让它读完整文档帮你诊断；
          或回到 <Link to="/console" className="text-accent font-semibold underline underline-offset-2">控制台</Link> 看是否已有调用记录。
        </div>
      </main>
    </div>
  );
}

function Step({
  n,
  title,
  body,
  last = false,
}: {
  n: string;
  title: string;
  body: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`flex items-start gap-4 ${last ? '' : 'pb-5 border-b-2 border-ink/10'}`}>
      <span className="w-8 h-8 flex-shrink-0 bg-ink text-bg border-2 border-ink rounded-md font-mono text-[14px] font-bold flex items-center justify-center shadow-[2px_2px_0_0_#1C1917]/30 mt-0.5">
        {n}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-bold text-ink mb-2 leading-snug">{title}</div>
        <div className="text-[13.5px] text-text-secondary leading-relaxed">{body}</div>
      </div>
    </div>
  );
}
