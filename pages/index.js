// pages/index.js
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useAuth } from './_app';

export default function Home() {
  const router = useRouter();
  const { isLoggedIn, loading } = useAuth();

  // 로그인 여부에 따라 리다이렉트
  useEffect(() => {
    if (!loading) {
      if (isLoggedIn) {
        router.push('/b2b');
      } else {
        router.push('/login');
      }
    }
  }, [isLoggedIn, loading, router]);

  // 로딩 중 화면 표시
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <Head>
        <title>홈</title>
      </Head>
      <div className="text-xl font-medium text-gray-700">로딩 중...</div>
    </div>
  );
}
