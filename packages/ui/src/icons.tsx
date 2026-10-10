import {
  Settings2,
  X,
  ArrowRight,
  PanelsTopLeft,
  GitPullRequest,
  Users,
  Mail,
  GitBranch,
  Menu,
  ChevronRight,
  ChevronDown,
  ShieldCheck,
  RefreshCw,
  ArrowLeft,
  FolderGit2,
  Plus,
  LogOut,
} from "lucide-react";

const icons = {
  settings: Settings2,
  close: X,
  arrowRight: ArrowRight,
  dashboard: PanelsTopLeft,
  reviews: GitPullRequest,
  members: Users,
  mail: Mail,
  github: GitBranch,
  menu: Menu,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  shield: ShieldCheck,
  refresh: RefreshCw,
  arrowLeft: ArrowLeft,
  repository: FolderGit2,
  plus: Plus,
  signout: LogOut,
};
export function Icon({
  name,
  label,
}: {
  name: keyof typeof icons;
  label?: string;
}) {
  const Component = icons[name];
  return (
    <Component
      width={20}
      height={20}
      strokeWidth={1.75}
      aria-hidden={label === undefined || undefined}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      focusable="false"
    />
  );
}
