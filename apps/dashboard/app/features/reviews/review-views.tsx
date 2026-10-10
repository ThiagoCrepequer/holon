import type {
  PrivateReviewDetail,
  PrivateReviewPage,
} from "@holon/contracts/dashboard-reviews";
import { Badge } from "@holon/ui/badge";
import { Button } from "@holon/ui/button";
import { Card, CardHeader, CardTitle } from "@holon/ui/card";
import { Icon } from "@holon/ui/icons";
import { InputField } from "@holon/ui/input-field";
import { SelectField } from "@holon/ui/select-field";
import { useLingui } from "@lingui/react";
import { Link } from "react-router";

import type { reviewParameters } from "../../review-parameters.js";
import { ReviewCode } from "./review-code.js";
import { ReviewMarkdown } from "./review-markdown.js";
import { reviewStateMessages } from "./review-messages.js";

type Destination = (
  path: string,
  cursor?: string | null,
  pr?: number,
) => string;
export function ReviewFilters({
  parameters,
  interactive,
  apply,
}: {
  parameters: ReturnType<typeof reviewParameters>;
  interactive: boolean;
  apply: (form: HTMLFormElement) => void;
}) {
  const { i18n } = useLingui();
  const states = reviewStateMessages(i18n);
  return (
    <form
      className="grid items-end gap-4 rounded-lg border border-border bg-card p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        apply(event.currentTarget);
      }}
    >
      <InputField
        label={i18n._({
          id: "reviews.search",
          message: "Search title or PR number",
        })}
        disabled={!interactive}
        name="search"
        maxLength={200}
        defaultValue={"search" in parameters ? parameters.search : ""}
      />
      <SelectField
        label={i18n._({ id: "reviews.status", message: "Review status" })}
        name="status"
        disabled={!interactive}
        defaultValue={"status" in parameters ? (parameters.status ?? "") : ""}
        options={[
          {
            value: "",
            label: i18n._({ id: "reviews.all", message: "All states" }),
          },
          ...Object.entries(states).map(([value, label]) => ({ value, label })),
        ]}
      />
      <SelectField
        label={i18n._({ id: "reviews.order", message: "Order" })}
        name="order"
        disabled={!interactive}
        defaultValue="activity"
        options={[
          {
            value: "activity",
            label: i18n._({
              id: "reviews.activityOrder",
              message: "Latest activity",
            }),
          },
        ]}
      />
      <Button type="submit" disabled={!interactive}>
        {i18n._({ id: "reviews.apply", message: "Apply filters" })}
      </Button>
    </form>
  );
}
export function ReviewList({
  page,
  locale,
  timezone,
  href,
  remember,
}: {
  page: PrivateReviewPage;
  locale: string;
  timezone: string;
  href: Destination;
  remember: (number: number) => void;
}) {
  const { i18n } = useLingui();
  const states = reviewStateMessages(i18n);
  const dates = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });
  return (
    <Card
      className="p-0"
      aria-label={i18n._({ id: "reviews.title", message: "Reviews" })}
    >
      <CardHeader className="mb-0 border-b border-border px-6 py-4">
        <CardTitle>
          {i18n._({ id: "reviews.activity", message: "Review activity" })}
        </CardTitle>
        <span className="text-small text-secondary">
          <span className="font-mono font-medium text-foreground">
            {page.total}
          </span>{" "}
          {i18n._({ id: "reviews.results", message: "results" })}
        </span>
      </CardHeader>
      <ul className="divide-y divide-border">
        {page.items.map((item) => (
          <li
            key={item.pullRequestNumber}
            className="grid min-w-0 gap-3 px-6 py-5 sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="min-w-0">
              <Link
                id={`review-${item.pullRequestNumber}`}
                className="flex items-start gap-3 rounded-md font-semibold wrap-anywhere"
                to={href("/reviews/detail", null, item.pullRequestNumber)}
                onClick={() => remember(item.pullRequestNumber)}
              >
                <span className="mt-1 shrink-0 text-secondary">
                  <Icon name="reviews" />
                </span>
                <span>
                  #{item.pullRequestNumber} · {item.title}
                </span>
              </Link>
              <p className="mt-2 text-small text-secondary">{item.author}</p>
            </div>
            <div className="grid justify-items-start gap-2 sm:justify-items-end">
              <Badge
                tone={
                  item.state === "completed"
                    ? "success"
                    : item.state === "failed_terminal"
                      ? "danger"
                      : item.state === "running"
                        ? "info"
                        : "neutral"
                }
              >
                {states[item.state]}
              </Badge>
              <p className="text-caption text-secondary">
                <span className="sr-only">
                  {i18n._({
                    id: "reviews.snapshotAt",
                    message: "Snapshot observed at",
                  })}{" "}
                </span>
                <time dateTime={item.observedAt}>
                  {dates.format(new Date(item.observedAt))}
                </time>
              </p>
            </div>
          </li>
        ))}
      </ul>
      {!page.items.length && (
        <div className="grid justify-items-center gap-3 px-6 py-12 text-center">
          <Icon name="reviews" />
          <p className="font-medium">
            {i18n._({
              id: "reviews.empty",
              message: "No reviews match these filters.",
            })}
          </p>
          <p className="max-w-reading text-small text-secondary">
            {i18n._({
              id: "reviews.emptyHint",
              message: "Try another title, PR number, or review status.",
            })}
          </p>
        </div>
      )}
      {page.nextCursor && (
        <div className="border-t border-border px-6 py-4 text-right">
          <Link
            className="inline-flex min-h-control items-center gap-2 rounded-md text-small font-semibold"
            to={href("/reviews", page.nextCursor)}
          >
            {i18n._({ id: "reviews.next", message: "Next page" })}
            <Icon name="arrowRight" />
          </Link>
        </div>
      )}
    </Card>
  );
}
export function ReviewDetail({
  detail,
  href,
  back,
}: {
  detail: PrivateReviewDetail;
  href: Destination;
  back: () => void;
}) {
  const { i18n } = useLingui();
  const states = reviewStateMessages(i18n);
  const severities = {
    critical: i18n._({ id: "severity.critical", message: "Critical" }),
    high: i18n._({ id: "severity.high", message: "High" }),
    medium: i18n._({ id: "severity.medium", message: "Medium" }),
    low: i18n._({ id: "severity.low", message: "Low" }),
  };
  const statuses = {
    new: i18n._({ id: "finding.new", message: "New" }),
    persistent: i18n._({ id: "finding.persistent", message: "Persistent" }),
    resolved: i18n._({ id: "finding.resolved", message: "Resolved" }),
    obsolete: i18n._({ id: "finding.obsolete", message: "Obsolete" }),
    reintroduced: i18n._({
      id: "finding.reintroduced",
      message: "Reintroduced",
    }),
    dismissed: i18n._({ id: "finding.dismissed", message: "Dismissed" }),
  };
  return (
    <>
      <Link
        className="flex w-fit max-w-full min-w-0 items-center gap-2 rounded-md text-small font-semibold"
        to={href("/reviews")}
        onClick={(event) => {
          event.preventDefault();
          back();
        }}
      >
        <Icon name="arrowLeft" />
        {i18n._({ id: "reviews.back", message: "Back to reviews" })}
      </Link>
      <Card>
        <h2
          tabIndex={-1}
          id="review-detail-title"
          className="text-title-md leading-title font-semibold tracking-tight wrap-anywhere"
        >
          #{detail.review.pullRequestNumber} · {detail.review.title}
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Badge>{states[detail.review.state]}</Badge>
          <code className="font-mono text-caption text-secondary wrap-anywhere">
            {detail.review.headSha}
          </code>
        </div>
        {detail.summary && (
          <section
            className="mt-6 border-t border-border pt-4"
            aria-label={i18n._({ id: "reviews.summary", message: "Summary" })}
          >
            <ReviewMarkdown>{detail.summary}</ReviewMarkdown>
          </section>
        )}
      </Card>
      <p className="text-title-sm font-semibold">
        <span className="font-mono">{detail.totalFindings}</span>{" "}
        {i18n._({ id: "reviews.findings", message: "findings" })}
      </p>
      <ol className="grid min-w-0 gap-6">
        {detail.findings.map((finding) => (
          <li
            id={`finding-${finding.fingerprint}`}
            key={finding.fingerprint}
            className="min-w-0 rounded-lg border border-border bg-card p-6"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <strong className="flex min-w-0 flex-wrap items-center gap-3">
                <Badge
                  tone={
                    finding.severity === "critical" ||
                    finding.severity === "high"
                      ? "danger"
                      : finding.severity === "medium"
                        ? "warning"
                        : "info"
                  }
                >
                  {severities[finding.severity]}
                </Badge>
                <span className="font-mono text-small wrap-anywhere">
                  {finding.location.path}:{finding.location.line}
                </span>
              </strong>
              <span className="text-small text-secondary">
                {statuses[finding.status]}
              </span>
            </div>
            <ReviewMarkdown>{finding.diagnostic}</ReviewMarkdown>
            {finding.evidence.map((evidence, index) => (
              <figure className="my-4 min-w-0" key={index}>
                <figcaption className="mb-2 text-small text-secondary wrap-anywhere">
                  {evidence.path}:{evidence.startLine} · {evidence.reason}
                </figcaption>
                <ReviewCode>{evidence.excerpt}</ReviewCode>
              </figure>
            ))}
            {finding.suggestion && (
              <ReviewCode>
                {typeof finding.suggestion === "string"
                  ? finding.suggestion
                  : JSON.stringify(finding.suggestion)}
              </ReviewCode>
            )}
          </li>
        ))}
      </ol>
      {detail.nextCursor && (
        <Link
          className="flex min-h-control w-fit items-center gap-2 rounded-md text-small font-semibold"
          to={href("/reviews/detail", detail.nextCursor)}
        >
          {i18n._({ id: "reviews.nextFindings", message: "More findings" })}
          <Icon name="arrowRight" />
        </Link>
      )}
    </>
  );
}
