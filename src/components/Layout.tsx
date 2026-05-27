import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ClipboardList,
  CreditCard,
  DatabaseZap,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Tags,
  UserCog,
  Users2,
  Users,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { fetchMe, searchCandidates } from '@/src/lib/api';
import type { AuthUser, CandidateSearchItem, UserRole } from '@/src/types';

interface LayoutProps {
  children: React.ReactNode;
}

type NavItem = {
  name: string;
  href?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  roles: UserRole[];
  group: 'main' | 'system';
};

const navigation: NavItem[] = [
  { name: '首页', href: '/', icon: LayoutDashboard, roles: ['admin', 'student_affairs', 'college_admin', 'counselor'], group: 'main' },
  { name: '认定批次', href: '/batches', icon: ClipboardList, roles: ['admin', 'student_affairs'], group: 'main' },
  { name: '候选名单', href: '/candidates', icon: Users, roles: ['admin', 'student_affairs', 'college_admin', 'counselor'], group: 'main' },
  { name: '审核中心', href: '/audit', icon: ShieldCheck, roles: ['admin', 'student_affairs', 'college_admin', 'counselor'], group: 'main' },
  { name: '补助表单', href: '/forms', icon: CreditCard, roles: ['admin', 'student_affairs'], group: 'main' },
  { name: '系统设置', icon: Settings, roles: ['admin', 'student_affairs'], group: 'main' },
  { name: '数据同步', href: '/sync', icon: DatabaseZap, roles: ['admin', 'student_affairs'], group: 'system' },
  { name: '字典管理', href: '/tags', icon: Tags, roles: ['admin', 'student_affairs'], group: 'system' },
  { name: '审核权限', href: '/roles', icon: UserCog, roles: ['admin', 'student_affairs'], group: 'system' },
  { name: '系统角色', href: '/system-roles', icon: UserCog, roles: ['admin', 'student_affairs'], group: 'system' },
  { name: '用户管理', href: '/user-management', icon: Users2, roles: ['admin', 'student_affairs'], group: 'system' },
];

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const [me, setMe] = React.useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = React.useState(false);
  const [searchText, setSearchText] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<CandidateSearchItem[]>([]);
  const [showSearchResults, setShowSearchResults] = React.useState(false);
  const [searching, setSearching] = React.useState(false);

  const isAuthPage = location.pathname === '/login';

  React.useEffect(() => {
    if (isAuthPage) {
      setAuthChecked(true);
      return;
    }

    let cancelled = false;
    fetchMe()
      .then((payload) => {
        if (cancelled) return;
        setMe(payload.data.user);
        setAuthChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        setMe(null);
        setAuthChecked(true);
        const redirect = `${location.pathname}${location.search}`;
        navigate(`/login?redirect=${encodeURIComponent(redirect)}`, { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthPage, location.pathname, location.search, navigate]);

  React.useEffect(() => {
    const keyword = searchText.trim();
    if (keyword.length < 1) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    const timer = setTimeout(() => {
      setSearching(true);
      searchCandidates(keyword)
        .then((payload) => {
          setSearchResults(payload.items);
          setShowSearchResults(true);
        })
        .catch(() => {
          setSearchResults([]);
          setShowSearchResults(false);
        })
        .finally(() => {
          setSearching(false);
        });
    }, 220);

    return () => clearTimeout(timer);
  }, [searchText]);

  const gotoStudentDetail = React.useCallback((item: CandidateSearchItem) => {
    setShowSearchResults(false);
    setSearchText('');
    navigate(`/students/${item.studentId}?month=${encodeURIComponent(item.month)}`);
  }, [navigate]);

  React.useEffect(() => {
    if (isAuthPage) return;
    if (!me?.role) return;

    const matched = navigation.find((item) => item.href && item.href === location.pathname);
    if (matched && !matched.roles.includes(me.role)) {
      navigate('/', { replace: true });
    }
  }, [isAuthPage, location.pathname, me?.role, navigate]);

  if (isAuthPage) {
    return <>{children}</>;
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">
        加载中...
      </div>
    );
  }

  const visibleNav = me?.role ? navigation.filter((item) => item.roles.includes(me.role)) : [];
  const mainNav = visibleNav.filter((item) => item.group === 'main');
  const systemNav = visibleNav.filter((item) => item.group === 'system');

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transition-transform duration-300 ease-in-out lg:translate-x-0',
          !isSidebarOpen && '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="h-full flex flex-col">
          <div className="p-6 flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
              <ShieldCheck size={20} />
            </div>
            <span className="font-bold text-lg text-slate-900 tracking-tight">饮食补助系统</span>
          </div>

          <ScrollArea className="flex-1 px-4">
            <nav className="space-y-1">
              {mainNav.map((item) => {
                const isActive = item.href ? location.pathname === item.href : false;
                const Icon = item.icon;
                if (!item.href) {
                  return (
                    <div
                      key={item.name}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-700"
                    >
                      <Icon size={18} className="text-slate-500" />
                      {item.name}
                    </div>
                  );
                }
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                      isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    )}
                  >
                    <Icon size={18} className={isActive ? 'text-blue-700' : 'text-slate-500'} />
                    {item.name}
                  </Link>
                );
              })}

              {systemNav.length > 0 ? (
                <div className="mt-1 space-y-1 pl-6">
                  {systemNav.map((item) => {
                    if (!item.href) return null;
                    const isActive = location.pathname === item.href;
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                          isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                        )}
                      >
                        <Icon size={18} className={isActive ? 'text-blue-700' : 'text-slate-500'} />
                        {item.name}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </nav>
          </ScrollArea>

          <div className="p-4 border-t border-slate-200">
            <div className="flex items-center gap-3 px-3 py-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src="https://github.com/shadcn.png" />
                <AvatarFallback>{(me?.name || '用户').slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{me?.name || '-'}</p>
                <p className="text-xs text-slate-500 truncate">{me?.employeeNo || '-'}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-slate-500"
                onClick={() => {
                  window.location.href = '/api/auth/signout';
                }}
                title="退出登录"
              >
                <LogOut size={16} />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 lg:ml-64">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-40">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
              <Menu size={20} />
            </Button>
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="搜索学生姓名、学号..."
                className="pl-10 pr-4 py-2 bg-slate-100 border-none rounded-full text-sm w-64 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onFocus={() => {
                  if (searchResults.length > 0) setShowSearchResults(true);
                }}
                onBlur={() => {
                  setTimeout(() => setShowSearchResults(false), 120);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchResults.length > 0) {
                    e.preventDefault();
                    gotoStudentDetail(searchResults[0]);
                  }
                }}
              />
              {showSearchResults ? (
                <div className="absolute left-0 right-0 top-11 z-50 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  {searching ? <div className="px-3 py-2 text-xs text-slate-500">搜索中...</div> : null}
                  {!searching && searchResults.length === 0 ? <div className="px-3 py-2 text-xs text-slate-500">未找到候选学生</div> : null}
                  {!searching
                    ? searchResults.map((item) => (
                        <button
                          key={`${item.month}-${item.studentId}`}
                          type="button"
                          className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => gotoStudentDetail(item)}
                        >
                          <div className="text-sm font-medium text-slate-900">{item.name}（{item.studentId}）</div>
                          <div className="text-xs text-slate-500">{item.college} / {item.className} · {item.month}</div>
                        </button>
                      ))
                    : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="relative text-slate-600" title="通知">
              <Bell size={20} />
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
