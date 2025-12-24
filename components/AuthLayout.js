// components/AuthLayout.js
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../pages/_app';
import Navbar from './Navbar';

export default function AuthLayout({ children }) {
  const router = useRouter();
  const { isLoggedIn, loading, canAccessAllPages, isField } = useAuth();

  useEffect(() => {
    if (!loading) {
      // 로그인되지 않은 경우 로그인 페이지로 리다이렉트
      if (!isLoggedIn) {
        router.push('/login');
      }
      // 현장직인 경우 FOUND 페이지로 리다이렉트
      else if (isField) {
        router.push('/found');
      }
    }
  }, [isLoggedIn, loading, isField, router]);

  // 초기 로딩 중일 때만 로딩 표시
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-xl font-medium text-gray-700">로딩 중...</div>
      </div>
    );
  }

  // 로그인되지 않았거나 권한이 없으면 빈 화면 (리다이렉트 중)
  if (!isLoggedIn || !canAccessAllPages) {
    return null;
  }

  // 사무직/관리자인 경우에만 내용 표시
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      {children}
    </div>
  );
}
