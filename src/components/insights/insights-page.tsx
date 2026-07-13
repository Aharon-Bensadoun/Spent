"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  CircleDollarSign,
  Goal,
  Loader2,
  Plus,
  ReceiptText,
  Sparkles,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createSavingsGoal,
  decideAgentProposal,
  dismissFinancialInsight,
  getInsights,
  setRecurringStatus,
} from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type {
  AgentProposal,
  CashFlowForecastPoint,
  FinancialInsight,
  RecurringSeries,
  SavingsGoal,
  RecurringStatus,
} from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const QUERY_KEY = ["insights"] as const;

export function InsightsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getInsights });
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  return (
    <>
      <PageHeader
        title="Insights"
        meta="Evidence-based"
        actions={<NewGoalDialog onCreated={refresh} />}
      />
      <div className="space-y-8 p-4 md:p-6 lg:p-8">
        {query.isLoading && <LoadingState />}
        {query.isError && (
          <div className="border-y py-12 text-center text-sm text-muted-foreground">
            Financial insights could not be calculated. Check the latest bank sync and try again.
          </div>
        )}
        {query.data && (
          <>
            <ForecastRail
              forecast={query.data.forecast}
              totalBalance={query.data.totalBalance}
              savings={query.data.potentialMonthlySavings}
            />
            {query.data.proposals.length > 0 && (
              <ProposalQueue proposals={query.data.proposals} onResolved={refresh} />
            )}
            <section aria-labelledby="opportunities-heading">
              <SectionHeading
                id="opportunities-heading"
                title="Decisions worth reviewing"
                count={query.data.insights.length}
              />
              {query.data.insights.length === 0 ? (
                <EmptyLine text="No sufficiently reliable savings opportunity was detected." />
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {query.data.insights.map((insight) => (
                    <InsightRow key={insight.id} insight={insight} onDismissed={refresh} />
                  ))}
                </div>
              )}
            </section>
            <div className="grid gap-8 xl:grid-cols-[1.35fr_1fr]">
              <RecurringSection recurring={query.data.recurring} onChanged={refresh} />
              <GoalsSection goals={query.data.goals} onCreated={refresh} />
            </div>
          </>
        )}
      </div>
    </>
  );
}

function ForecastRail({
  forecast,
  totalBalance,
  savings,
}: {
  forecast: CashFlowForecastPoint[];
  totalBalance: number | null;
  savings: number;
}) {
  return (
    <section className="overflow-hidden border-y border-border bg-card/45" aria-labelledby="forecast-heading">
      <div className="grid lg:grid-cols-[1.15fr_2fr]">
        <div className="border-b p-5 lg:border-r lg:border-b-0 lg:p-7">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <CalendarClock className="h-4 w-4" /> Cash runway
          </div>
          <h2 id="forecast-heading" className="mt-4 font-serif text-3xl font-semibold">
            {totalBalance == null ? "Balance pending" : formatCurrency(totalBalance)}
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Current known balance. Forecasts use six months of income and spending history.
          </p>
          {savings > 0 && (
            <div className="mt-5 flex items-center gap-2 text-sm font-medium text-primary">
              <CircleDollarSign className="h-4 w-4" />
              {formatCurrency(savings)} monthly review potential
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 divide-x">
          {forecast.map((point) => (
            <div key={point.days} className="min-w-0 p-4 md:p-6">
              <div className="text-xs font-semibold text-muted-foreground">{point.days} days</div>
              <div className={cn(
                "mt-3 truncate text-lg font-semibold md:text-2xl",
                point.central < 0 && "text-destructive"
              )}>
                {formatCurrency(point.central)}
              </div>
              <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
                {formatCurrency(point.conservative)} to {formatCurrency(point.optimistic)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionHeading({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4 border-b pb-3">
      <h2 id={id} className="font-serif text-xl font-semibold">{title}</h2>
      <span className="text-xs text-muted-foreground">{count} active</span>
    </div>
  );
}

function InsightRow({ insight, onDismissed }: { insight: FinancialInsight; onDismissed: () => void }) {
  const mutation = useMutation({
    mutationFn: () => dismissFinancialInsight(insight.id),
    onSuccess: onDismissed,
  });
  const merchant = insight.evidence.merchant;
  return (
    <article className="flex min-h-44 flex-col rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            insight.severity === "critical" ? "bg-destructive/10 text-destructive" :
              insight.severity === "warning" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" :
                "bg-primary/10 text-primary"
          )}>
            {insight.kind === "recurring" ? <ReceiptText className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{insight.title}</h3>
              <Badge variant="outline">{insight.kind.replace("_", " ")}</Badge>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{insight.summary}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Dismiss ${insight.title}`}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <X />}
        </Button>
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <div>
          {insight.annualImpact != null && (
            <div className="text-lg font-semibold">{formatCurrency(insight.annualImpact)}<span className="text-xs font-normal text-muted-foreground"> / year</span></div>
          )}
          <div className="text-[11px] text-muted-foreground">
            {insight.evidence.transactionIds?.length ?? 0} supporting transaction(s)
          </div>
        </div>
        <Button variant="ghost" size="sm" render={<Link href={merchant ? `/transactions?search=${encodeURIComponent(merchant)}` : "/transactions"} />}>
          View evidence <ArrowRight />
        </Button>
      </div>
    </article>
  );
}

function RecurringSection({ recurring, onChanged }: { recurring: RecurringSeries[]; onChanged: () => void }) {
  return (
    <section aria-labelledby="recurring-heading">
      <SectionHeading id="recurring-heading" title="Recurring commitments" count={recurring.length} />
      <div className="divide-y border-y">
        {recurring.slice(0, 10).map((item) => (
          <RecurringRow key={item.id} item={item} onChanged={onChanged} />
        ))}
        {recurring.length === 0 && <EmptyLine text="No stable recurring pattern yet." />}
      </div>
    </section>
  );
}

function RecurringRow({ item, onChanged }: { item: RecurringSeries; onChanged: () => void }) {
  const mutation = useMutation({
    mutationFn: (status: RecurringStatus) => setRecurringStatus(item.id, status),
    onSuccess: onChanged,
  });
  return (
    <div className="grid gap-3 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{item.displayName}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {item.cadence} · {Math.round(item.confidence * 100)}% confidence
          {item.nextExpectedDate ? ` · next ${formatDate(item.nextExpectedDate)}` : ""}
        </div>
      </div>
      <div className="sm:text-right">
        <div className="text-sm font-semibold">{formatCurrency(item.monthlyCost)}</div>
        <div className="text-[11px] text-muted-foreground">monthly</div>
      </div>
      <Select
        value={item.status}
        onValueChange={(value) => mutation.mutate(value as RecurringStatus)}
        disabled={mutation.isPending}
      >
        <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="detected">Detected</SelectItem>
          <SelectItem value="subscription">Subscription</SelectItem>
          <SelectItem value="essential">Essential</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
          <SelectItem value="ignored">Ignore</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function GoalsSection({ goals, onCreated }: { goals: SavingsGoal[]; onCreated: () => void }) {
  return (
    <section aria-labelledby="goals-heading">
      <div className="mb-4 flex items-center justify-between border-b pb-3">
        <h2 id="goals-heading" className="font-serif text-xl font-semibold">Savings goals</h2>
        <NewGoalDialog onCreated={onCreated} iconOnly />
      </div>
      <div className="space-y-4">
        {goals.map((goal) => {
          const percent = Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
          return (
            <div key={goal.id}>
              <div className="mb-2 flex items-end justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{goal.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatCurrency(goal.currentAmount)} of {formatCurrency(goal.targetAmount)}
                  </div>
                </div>
                <span className="text-xs font-semibold">{Math.round(percent)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
              </div>
            </div>
          );
        })}
        {goals.length === 0 && <EmptyLine text="Create a goal to give savings recommendations a destination." />}
      </div>
    </section>
  );
}

function ProposalQueue({ proposals, onResolved }: { proposals: AgentProposal[]; onResolved: () => void }) {
  return (
    <section aria-labelledby="proposals-heading" className="border-l-4 border-primary bg-primary/5 px-4 py-3">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 id="proposals-heading" className="text-sm font-semibold">Awaiting your confirmation</h2>
      </div>
      <div className="divide-y divide-primary/15">
        {proposals.map((proposal) => (
          <ProposalRow key={proposal.id} proposal={proposal} onResolved={onResolved} />
        ))}
      </div>
    </section>
  );
}

function ProposalRow({ proposal, onResolved }: { proposal: AgentProposal; onResolved: () => void }) {
  const mutation = useMutation({
    mutationFn: (decision: "confirm" | "reject") => decideAgentProposal(proposal.id, decision),
    onSuccess: onResolved,
  });
  return (
    <div className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{proposal.title}</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{proposal.rationale}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate("reject")}>
          Reject
        </Button>
        <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate("confirm")}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Check />} Confirm
        </Button>
      </div>
    </div>
  );
}

function NewGoalDialog({ onCreated, iconOnly = false }: { onCreated: () => void; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const mutation = useMutation({
    mutationFn: () => createSavingsGoal({ name, targetAmount: Number(amount), targetDate: date || null }),
    onSuccess: () => {
      setOpen(false);
      setName("");
      setAmount("");
      setDate("");
      onCreated();
    },
  });
  const valid = name.trim().length > 0 && Number.isFinite(Number(amount)) && Number(amount) > 0;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size={iconOnly ? "icon-sm" : "sm"} variant={iconOnly ? "ghost" : "default"} aria-label="Create savings goal" />}>
        <Plus /> {!iconOnly && "New goal"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Goal className="h-5 w-5" /> Create savings goal</DialogTitle>
          <DialogDescription>Track progress and connect future recommendations to a concrete target.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2"><Label htmlFor="goal-name">Name</Label><Input id="goal-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Emergency fund" /></div>
          <div className="space-y-2"><Label htmlFor="goal-amount">Target amount (ILS)</Label><Input id="goal-amount" type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="goal-date">Target date</Label><Input id="goal-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
          {mutation.isError && <p className="text-sm text-destructive">The goal could not be created.</p>}
          <Button className="w-full" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="animate-spin" /> : <Goal />} Create goal
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LoadingState() {
  return <div className="flex items-center justify-center gap-2 border-y py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Calculating patterns across transaction history...</div>;
}

function EmptyLine({ text }: { text: string }) {
  return <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><CircleDollarSign className="h-4 w-4" />{text}</div>;
}
