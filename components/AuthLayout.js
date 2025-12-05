// components/AuthLayout.js
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../pages/_app';
import Navbar from './Navbar';

export default function AuthLayout({ children }) {
  const router = useRouter();
  const { isLoggedIn, loading } = useAuth();

  useEffect(() => {
    // 로딩이 완료되고 로그인 상태가 아닐 때 로그인 페이지로 리다이렉트
    if (!loading && !isLoggedIn) {
      router.push('/login');
    }
  }, [isLoggedIn, loading, router]);

  // 초기 로딩 중일 때만 로딩 표시 (이미 로그인된 상태에서 페이지 전환 시에는 바로 표시)
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-xl font-medium text-gray-700">로딩 중...</div>
      </div>
    );
  }

  // 로그인되지 않았으면 빈 화면 (리다이렉트 중)
  if (!isLoggedIn) {
    return null;
  }

  // 로그인된 경우에만 내용 표시
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      {children}
    </div>
  );
}
