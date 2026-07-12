import { Link } from 'react-router-dom';
import { useEffect } from 'react';

/**
 * 政策页（服务条款 / 隐私政策 / 退款政策）。三份文档共用一个壳，
 * 由路由传入的 `doc` 决定内容。内容为面向「AI 大模型 API 额度」数字
 * 服务的标准条款；退款政策明确不支持退款（保留法律强制/重复扣款的
 * 人工核实通道）。任何一处需改动业务口径时改这里即可。
 *
 * 联系邮箱用 support@tokenboss.co —— 上线前需在域名商配好转发。
 */

const CONTACT_EMAIL = 'support@tokenboss.co';
const LAST_UPDATED = '2026-07-12';

type LegalDoc = 'terms' | 'privacy' | 'refund';

interface Section {
  heading: string;
  body: string[];
}

const DOCS: Record<LegalDoc, { title: string; intro: string; sections: Section[] }> = {
  terms: {
    title: '服务条款',
    intro:
      '欢迎使用 TokenBoss。以下条款约定你与 TokenBoss（tokenboss.co，下称“本服务”）之间就使用本服务达成的协议。注册或使用本服务，即表示你已阅读并同意本条款。',
    sections: [
      {
        heading: '1. 服务说明',
        body: [
          '本服务提供 AI 大模型 API 额度的充值与调用转发：用户预付额度后，通过与 OpenAI 兼容的接口调用受支持的模型，额度按实际调用量扣减。本服务为纯数字服务，不涉及任何实物商品。',
          '受支持的模型清单、价格与可用性可能随上游供应商变化而调整，以控制台与接口返回的实时信息为准。',
        ],
      },
      {
        heading: '2. 账户',
        body: [
          '你需通过有效邮箱注册账户。你应对账户凭证与 API Key 的保密负责，并对以你账户发起的所有活动负责。若发现未授权使用，请立即联系我们。',
          '你承诺注册与使用中提供的信息真实、准确、完整。',
        ],
      },
      {
        heading: '3. 额度与计费',
        body: [
          '额度为预付性质，充值成功后即时到账，永不过期，可用于全部受支持模型。额度以美元计价单位记账。',
          '每次 API 调用按对应模型的计费规则从余额扣减。余额不足时相关调用将被拒绝，你可随时充值继续使用。',
          '额度仅可用于本服务内的模型调用，不可提现、不可转让、不可兑换现金。',
        ],
      },
      {
        heading: '4. 付款',
        body: [
          '充值通过第三方支付渠道完成，可能包括银行卡 / 微信（由 Dodo Payments 作为记录商户 Merchant of Record 处理）、稳定币等。相关交易同时受对应支付渠道的条款约束。',
          '本服务不存储你的银行卡号、支付密码等敏感支付信息，这些信息由支付渠道直接处理。',
        ],
      },
      {
        heading: '5. 可接受使用',
        body: [
          '你不得将本服务用于任何违反适用法律法规的用途，包括但不限于生成违法内容、侵犯他人权利、发送垃圾信息、进行网络攻击或规避上游模型供应商的使用政策。',
          '你不得对本服务进行逆向工程、滥用、超频请求或以任何方式干扰其正常运行。',
          '我们有权在合理判断你违反本条款时暂停或终止你的账户，且不退还剩余额度（法律强制要求的除外）。',
        ],
      },
      {
        heading: '6. 服务可用性',
        body: [
          '我们尽合理努力保持服务稳定可用，但本服务依赖第三方上游模型供应商与基础设施，可能出现中断、延迟或降级。对由上游或不可抗力导致的不可用，我们不承担责任。',
        ],
      },
      {
        heading: '7. 责任限制',
        body: [
          '在适用法律允许的最大范围内，本服务按“现状”提供，不作任何明示或默示担保。对于因使用或无法使用本服务导致的任何间接、附带或后果性损失，我们不承担责任；我们的累计责任上限以你为相关服务实际支付的金额为限。',
        ],
      },
      {
        heading: '8. 条款变更',
        body: [
          '我们可能不时更新本条款，更新后将在本页面公示并标注生效日期。变更后你继续使用本服务即视为接受更新后的条款。',
        ],
      },
      {
        heading: '9. 联系我们',
        body: [`如对本条款有任何疑问，请通过 ${CONTACT_EMAIL} 与我们联系。`],
      },
    ],
  },
  privacy: {
    title: '隐私政策',
    intro:
      '本隐私政策说明 TokenBoss（tokenboss.co）在你使用本服务时如何收集、使用和保护你的信息。我们只收集提供服务所必需的信息。',
    sections: [
      {
        heading: '1. 我们收集的信息',
        body: [
          '账户信息：你注册时提供的邮箱地址。',
          '使用信息：API 调用记录、额度扣减与充值记录，用于计费与安全审计。',
          '支付信息：由第三方支付渠道处理。我们不收集、不存储你的银行卡号或支付密码，仅接收渠道回传的、用于确认订单状态的必要信息（如订单号、支付结果）。',
        ],
      },
      {
        heading: '2. 我们如何使用信息',
        body: [
          '提供并维护服务、进行额度计费、处理充值订单、保障账户与平台安全、以及在你联系我们时提供支持。',
          '我们不会将你的信息出售给第三方。',
        ],
      },
      {
        heading: '3. 第三方',
        body: [
          '为提供服务，我们会与必要的第三方共享有限信息，包括：支付渠道（如 Dodo Payments 及稳定币渠道，用于处理充值）、上游 AI 模型供应商（用于转发你的调用请求）、以及云基础设施服务商（用于运行本服务）。这些第三方仅在为本服务提供功能所必需的范围内处理相关信息。',
        ],
      },
      {
        heading: '4. 数据留存',
        body: [
          '我们在提供服务及满足法律、财务与安全合规所必需的期间内保留你的信息。你注销账户后，我们将在合理期限内删除或匿名化不再需要的个人信息（法律要求保留的记录除外）。',
        ],
      },
      {
        heading: '5. 安全',
        body: [
          '我们采取合理的技术与管理措施保护你的信息免遭未授权访问、泄露或篡改。但请注意，任何通过互联网传输或存储的方式都无法保证绝对安全。',
        ],
      },
      {
        heading: '6. 你的权利',
        body: [
          '你有权访问、更正或删除你的个人信息。如需行使上述权利，请通过下方邮箱联系我们，我们将在合理期限内响应。',
        ],
      },
      {
        heading: '7. Cookie',
        body: [
          '本服务使用必要的本地存储 / Cookie 维持登录会话与基本功能，不用于跨站广告追踪。',
        ],
      },
      {
        heading: '8. 联系我们',
        body: [`如对本隐私政策有任何疑问，请通过 ${CONTACT_EMAIL} 与我们联系。`],
      },
    ],
  },
  refund: {
    title: '退款政策',
    intro:
      'TokenBoss 提供的充值额度为数字商品。请在充值前确认金额与需求。',
    sections: [
      {
        heading: '1. 不支持退款',
        body: [
          '充值额度一经充值成功、额度到账，即视为商品已交付完成。由于额度为可立即使用的数字商品，充值成功后不支持退款、不支持撤销。',
          '请在充值前确认所选金额。额度永不过期，可长期用于全部受支持模型，无需一次性大额充值。',
        ],
      },
      {
        heading: '2. 例外情形',
        body: [
          '在以下情形下，我们会在核实后按适用法律与支付渠道规则处理：（a）法律法规强制要求退款的；（b）因系统故障导致的重复扣款或错误扣款，且相关额度未被消耗的。',
          '上述情形请在发现后尽快通过下方邮箱联系我们，并提供订单号与相关凭证，以便我们核实处理。',
        ],
      },
      {
        heading: '3. 争议与联系',
        body: [
          `如对某笔充值有任何疑问或争议，请通过 ${CONTACT_EMAIL} 联系我们。若通过第三方支付渠道充值，你也可依据该渠道的政策发起争议处理。`,
        ],
      },
    ],
  },
};

export default function Legal({ doc }: { doc: LegalDoc }) {
  const d = DOCS[doc];

  useEffect(() => {
    document.title = `${d.title} · TokenBoss`;
  }, [d.title]);

  return (
    <div className="min-h-screen bg-bg pb-16">
      <main className="max-w-[720px] mx-auto px-5 sm:px-9 pt-8">
        <div className="font-mono text-[11px] tracking-[0.06em] text-[#A89A8D] mb-4">
          <Link to="/" className="hover:text-ink transition-colors">
            TokenBoss
          </Link>
          <span className="mx-2 text-[#D9CEC2]">/</span>
          <span className="text-ink-2">{d.title}</span>
        </div>

        <h1 className="text-[32px] md:text-[40px] font-bold tracking-tight leading-[1.1] mb-2">
          {d.title}
        </h1>
        <p className="font-mono text-[11px] text-ink-3 mb-6">最后更新：{LAST_UPDATED}</p>

        <p className="text-[14px] text-text-secondary leading-relaxed mb-8">{d.intro}</p>

        <div className="space-y-7">
          {d.sections.map((s) => (
            <section key={s.heading}>
              <h2 className="text-[16px] font-bold text-ink mb-2">{s.heading}</h2>
              <div className="space-y-2">
                {s.body.map((p, i) => (
                  <p key={i} className="text-[13.5px] text-text-secondary leading-relaxed">
                    {p}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 pt-6 border-t border-ink/10 flex items-center gap-4 font-mono text-[11.5px]">
          <Link to="/terms" className="text-ink-2 hover:text-ink underline underline-offset-4 decoration-2">
            服务条款
          </Link>
          <Link to="/privacy" className="text-ink-2 hover:text-ink underline underline-offset-4 decoration-2">
            隐私政策
          </Link>
          <Link to="/refund" className="text-ink-2 hover:text-ink underline underline-offset-4 decoration-2">
            退款政策
          </Link>
        </div>
      </main>
    </div>
  );
}
