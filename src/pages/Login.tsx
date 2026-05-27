import React from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMe } from '@/src/lib/api';

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = React.useState(() => new URLSearchParams(window.location.search));
  const [message, setMessage] = React.useState('正在检查登录状态...');

  React.useEffect(() => {
    let cancelled = false;

    fetchMe()
      .then(() => {
        if (cancelled) return;
        const redirect = searchParams.get('redirect');
        const target = redirect && redirect.startsWith('/') ? redirect : '/';
        navigate(target, { replace: true });
      })
      .catch(() => {
        if (cancelled) return;
        setMessage('正在跳转统一认证登录...');
        const reauth = searchParams.get('reauth') === '1' ? '&reauth=1' : '';
        const redirect = searchParams.get('redirect');
        const redirectParam = redirect ? `&redirect=${encodeURIComponent(redirect)}` : '';
        window.location.href = `/api/auth/login/jmu?role=counselor${reauth}${redirectParam}`;
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="rounded-lg border border-slate-200 bg-white px-6 py-5 text-sm text-slate-600 shadow-sm">{message}</div>
    </div>
  );
}
