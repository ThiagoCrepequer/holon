import { invitationEmailSchema } from "@holon/contracts/dashboard-collaboration";
import { emailContextSchema } from "@holon/contracts/email-delivery";
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
  return {
    from: { email: sender, name: "Holon" },
    to: context.recipient,
    subject: title,
    text: `${title}\n\n${body}\n\n${action}: ${link}\n\n${detail}\n\n${notice}`,
    html: `<!doctype html><html lang="${context.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#FAF9F6;color:#111C2D;font-family:Manrope,Segoe UI,Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:560px"><tr><td><p style="font-size:24px;color:#603EB0">Holon</p><h1 style="font-size:28px;line-height:1.25">${title}</h1><p style="line-height:1.6">${escape(body)}</p><p style="padding:16px 0"><a href="${escape(link)}" style="display:inline-block;padding:14px 22px;background:#603EB0;color:#FFFFFF;border-radius:8px;text-decoration:none">${action}</a></p><p style="line-height:1.6">${escape(detail)}</p><p style="line-height:1.6;font-size:14px">${notice}</p><p style="font-size:12px;overflow-wrap:anywhere"><a href="${escape(link)}" style="color:#603EB0">${escape(link)}</a></p></td></tr></table></td></tr></table></body></html>`,
  };
}
