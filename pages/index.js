// pages/index.js
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useAuth } from './_app';
import AuthLayout from '@/components/AuthLayout';

export default function Home() {
  const router = useRouter();
  const { isLoggedIn, loading, canAccessAllPages, isField, isPrism } = useAuth();

  // 로그인되지 않은 경우 로그인 페이지로 리다이렉트
  // 현장직(field)인 경우 /found로 리다이렉트
  // 프리즘(prism)인 경우 /prism으로 리다이렉트
  useEffect(() => {
    if (!loading) {
      if (!isLoggedIn) {
        router.push('/login');
      } else if (isField) {
        router.push('/found');
      } else if (isPrism) {
        router.push('/prism');
      }
    }
  }, [isLoggedIn, loading, isField, isPrism, router]);

  // 로딩 중이거나 로그인되지 않았거나 현장직/프리즘인 경우
  if (loading || !isLoggedIn || !canAccessAllPages) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Head>
          <title>홈</title>
        </Head>
        <div className="text-xl font-medium text-gray-700">로딩 중...</div>
      </div>
    );
  }

  const menuItems = [
    { href: '/b2b', title: 'B2B택배', description: '택배 출고용 피킹지 생성', color: 'bg-blue-500' },
    { href: '/warehouse', title: '창고이동', description: '창고간 재고 이동 관리', color: 'bg-green-500' },
    { href: '/hap', title: 'HAP', description: '피킹리스트 관리', color: 'bg-purple-500' },
    { href: '/b2c2', title: 'B2C2', description: '엑셀 데이터 추출', color: 'bg-orange-500' },
    { href: '/find', title: '재고찾기', description: '로케이션 정렬', color: 'bg-teal-500' },
    { href: '/offbeauty', title: '오프뷰티', description: '오프뷰티 택배 운송장 매핑', color: 'bg-rose-500' },
    { href: '/found', title: '현장보고', description: '실물발견/없음 보고', color: 'bg-amber-500' },
    { href: '/g', title: 'G', description: 'G 페이지', color: 'bg-pink-500' },
    { href: '/prism', title: '프리즘창고', description: '프리즘창고 입출고 관리', color: 'bg-indigo-500' },
  ];

  return (
    <AuthLayout>
      <Head>
        <title>홈</title>
      </Head>
      <main className="py-10">
        <div className="max-w-4xl mx-auto px-4">
          <h1 className="text-3xl font-bold text-center text-gray-800 mb-8">
            메뉴
          </h1>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {menuItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <div className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow cursor-pointer overflow-hidden">
                  <div className={`${item.color} h-2`}></div>
                  <div className="p-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-2">
                      {item.title}
                    </h2>
                    <p className="text-gray-600 text-sm">
                      {item.description}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </AuthLayout>
  );
}
