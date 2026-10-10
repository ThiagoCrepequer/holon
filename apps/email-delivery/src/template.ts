import { invitationEmailSchema } from "@holon/contracts/dashboard-collaboration";
import { emailContextSchema } from "@holon/contracts/email-delivery";

import { emailBrand } from "./brand.generated.js";
function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function invitationMessage(
  raw: unknown,
  origin: string,
  from: string,
): EmailMessageBuilder {
  const context = emailContextSchema.parse(raw);
  const base = new URL(origin);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.origin !== origin
  )
    throw new Error("invalid_configuration");
  const sender = invitationEmailSchema.parse(from);
  const link = new URL(
    `/invitations/${encodeURIComponent(context.jobId)}`,
    base,
  ).href;
  const pt = context.locale === "pt-BR";
  const title = pt
    ? "Você recebeu um convite para o Holon"
    : "You’re invited to Holon";
  const body = pt
    ? `Você recebeu um convite para participar do workspace ${context.workspaceName}.`
    : `You’ve been invited to join the ${context.workspaceName} workspace.`;
  const action = pt ? "Abrir convite" : "Open invitation";
  const expiry = new Intl.DateTimeFormat(context.locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(context.expiresAt));
  const detail = pt
    ? `O convite expira em ${expiry} (UTC). Entre com o GitHub usando um email verificado correspondente ao destinatário.`
    : `This invitation expires on ${expiry} (UTC). Sign in with GitHub using a verified email matching the recipient.`;
  const notice = pt
    ? "Você pode receber esta mensagem mais de uma vez. É o mesmo convite. Se não esperava este convite, ignore a mensagem."
    : "You may receive this message more than once. It is the same invitation. If you weren’t expecting it, ignore this message.";
  const brand = emailBrand.light;
  const dark = emailBrand.dark;
  return {
    from: { email: sender, name: "Holon" },
    to: context.recipient,
    subject: title,
    text: `${title}\n\n${body}\n\n${action}: ${link}\n\n${detail}\n\n${notice}`,
    attachments: [
      {
        filename: "holon-semente.png",
        type: "image/png",
        disposition: "inline",
        contentId: "holon-semente",
        content: emailBrand.logo,
      },
    ],
    html: `<!doctype html>
<html lang="${context.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<style>@media(prefers-color-scheme:dark){.email-page{background:${dark.page}!important;color:${dark.text}!important}.email-card{background:${dark.surface}!important;color:${dark.text}!important;border-color:${dark.border}!important}.email-secondary{color:${dark.secondary}!important}.email-link{color:${dark.link}!important}.email-action{background:${dark.action}!important;color:${dark.actionText}!important;border-color:${dark.action}!important}}</style>
</head><body class="email-page" style="margin:0;background:${brand.page};color:${brand.text};font-family:Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="padding:0 0 24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td><img src="cid:holon-semente" width="44" height="44" alt="Holon" style="display:block;border:0;border-radius:10px"></td><td style="padding-left:12px;font-size:28px;font-weight:600;letter-spacing:-1px">holon</td></tr></table></td></tr>
<tr><td class="email-card" style="padding:28px 24px;background:${brand.surface};color:${brand.text};border:1px solid ${brand.border};border-radius:16px">
<h1 style="margin:0 0 20px;font-size:28px;font-weight:600;line-height:1.25;letter-spacing:-0.5px">${title}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.65">${escape(body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="email-action" align="center" bgcolor="${brand.action}" style="border-radius:10px;background:${brand.action}"><a class="email-action" href="${escape(link)}" style="display:inline-block;padding:14px 24px;border:1px solid ${brand.action};border-radius:10px;background:${brand.action};color:${brand.actionText};font-weight:600;font-size:16px;line-height:1.25;text-decoration:none">${action}</a></td></tr></table>
<p class="email-secondary" style="margin:24px 0 0;font-size:14px;line-height:1.65;color:${brand.secondary}">${escape(detail)}</p>
</td></tr>
<tr><td class="email-secondary" style="padding:24px 8px 0;font-size:12px;line-height:1.65;color:${brand.secondary}"><p style="margin:0 0 12px">${notice}</p><p style="margin:0;word-break:break-all"><a class="email-link" href="${escape(link)}" style="color:${brand.link}">${escape(link)}</a></p></td></tr>
</table></td></tr></table></body></html>`,
  };
}
