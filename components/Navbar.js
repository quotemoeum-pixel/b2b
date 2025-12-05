// components/Navbar.js
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '../pages/_app';

// 메뉴 구조 정의 - 추후 메뉴 추가 시 여기만 수정하면 됨
const menuGroups = [
  {
    label: '택배/출고',
    items: [
      { href: '/b2b', label: 'B2B택배' },
      { href: '/warehouse', label: '창고이동' },
    ]
  },
  {
    label: '피킹/패킹',
    items: [
      { href: '/g', label: '피킹/패킹 생성' },
      { href: '/pl', label: '패킹리스트' },
      { href: '/hap', label: '피킹리스트' },
    ]
  },
  {
    label: '조회/관리',
    items: [
      { href: '/box-update', label: 'EA/BOX 관리' },
      { href: '/weight-check', label: '무게조회' },
      { href: '/un', label: '롯데운송장' },
    ]
  }
];

// 페이지 제목 매핑
const pageTitles = {
  '/b2b': 'B2B택배',
  '/warehouse': '창고이동',
  '/box-update': 'EA/BOX 관리',
  '/pl': '패킹리스트',
  '/g': '피킹/패킹 생성',
  '/hap': '피킹리스트',
  '/weight-check': '무게조회',
  '/un': '롯데운송장',
  '/new': '재고확인',
};

function DropdownMenu({ label, items, currentPath }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasActiveItem = items.some(item => currentPath === item.href);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`text-sm font-medium py-1 px-2 rounded flex items-center gap-1 transition-colors ${
          hasActiveItem
            ? 'text-blue-600 bg-blue-50'
            : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50'
        }`}
      >
        {label}
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px] z-50">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setIsOpen(false)}
              className={`block px-4 py-2 text-sm transition-colors ${
                currentPath === item.href
                  ? 'text-blue-600 bg-blue-50 font-medium'
                  : 'text-gray-700 hover:bg-gray-50 hover:text-blue-600'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Navbar() {
  const { isLoggedIn, logout, user } = useAuth();
  const router = useRouter();
  const currentPath = router.pathname;
  const pageTitle = pageTitles[currentPath] || '';

  return (
    <nav className="bg-white shadow-sm py-2 px-4 border-b">
      <div className="max-w-full mx-auto flex justify-between items-center">
        {/* 왼쪽: 로고 + 현재 페이지 제목 */}
        <div className="flex items-center">
          <Link href="/b2b" className="text-lg font-bold text-gray-800 mr-4">
            HD
          </Link>
          {pageTitle && (
            <>
              <span className="text-gray-300 mr-4">|</span>
              <span className="text-base font-semibold text-blue-600">{pageTitle}</span>
            </>
          )}
        </div>

        {/* 중앙: 메뉴 그룹 */}
        <div className="flex space-x-2 items-center">
          {menuGroups.map((group) => (
            <DropdownMenu
              key={group.label}
              label={group.label}
              items={group.items}
              currentPath={currentPath}
            />
          ))}
        </div>

        {/* 오른쪽: 사용자 정보 */}
        {isLoggedIn && user && (
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">
              {user.email}
            </span>
            <button
              onClick={logout}
              className="text-sm font-medium text-white bg-red-500 hover:bg-red-600 py-1 px-3 rounded"
            >
              로그아웃
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
