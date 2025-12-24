import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '../_app';
import { LogOut, Home, Package, PackageX } from 'lucide-react';

const FoundItemsPage = () => {
  const router = useRouter();
  const { user, isAdmin, canAccessAllPages, logout, loading: authLoading } = useAuth();

  // 폼 상태
  const [itemType, setItemType] = useState('실물발견'); // '실물발견' | '실물없음'
  const [productCode, setProductCode] = useState('');
  const [productName, setProductName] = useState(''); // 자동 조회된 상품명
  const [expiryDate, setExpiryDate] = useState('');
  const [lot, setLot] = useState('');
  const [quantity, setQuantity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [searching, setSearching] = useState(false);

  const productCodeRef = useRef(null);

  // 로그인 체크
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  // 유통기한 포맷팅 (20251231 → 2025-12-31)
  const formatExpiryDate = (value) => {
    const cleaned = value.replace(/[^0-9]/g, '');
    if (cleaned.length === 8) {
      return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
    }
    return cleaned;
  };

  // 상품코드로 상품명 조회 (엔터키 또는 포커스 아웃 시에만 실행)
  const searchProduct = async (code) => {
    const trimmedCode = code?.trim();
    if (!trimmedCode) {
      setProductName('');
      return;
    }

    setSearching(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('product_name')
        .eq('product_code', trimmedCode)
        .maybeSingle();

      if (error) throw error;
      setProductName(data?.product_name || '');
    } catch (err) {
      console.error('상품 조회 오류:', err);
      setProductName('');
    } finally {
      setSearching(false);
    }
  };

  // 등록
  const handleSubmit = async () => {
    if (!productCode.trim()) {
      alert('상품코드를 입력하세요.');
      productCodeRef.current?.focus();
      return;
    }
    if (!quantity || parseInt(quantity) <= 0) {
      alert('수량을 입력하세요.');
      return;
    }

    setSubmitting(true);
    try {
      const insertData = {
        product_code: productCode.trim(),
        product_name: productName || productCode.trim(),
        expiry_date: expiryDate ? formatExpiryDate(expiryDate) : null,
        lot: lot || null,
        quantity: parseInt(quantity),
        item_type: itemType,
        status: '등록',
        created_by: user?.id || null,
        created_by_email: user?.email || '익명'
      };

      const { error } = await supabase.from('found_items').insert(insertData);

      if (error) throw error;

      alert('등록 완료!');

      // 폼 초기화 (유형은 유지)
      setProductCode('');
      setProductName('');
      setExpiryDate('');
      setLot('');
      setQuantity('');
      productCodeRef.current?.focus();

    } catch (error) {
      console.error('등록 오류:', error);
      alert('등록 실패: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  // 엔터키로 다음 필드 이동 또는 등록
  const handleKeyDown = (e, nextRef, shouldSearch = false) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (shouldSearch && productCode.trim()) {
        searchProduct(productCode);
      }
      if (nextRef) {
        nextRef.current?.focus();
      } else {
        handleSubmit();
      }
    }
  };

  // 상품코드 입력 필드에서 포커스 아웃 시 검색
  const handleProductCodeBlur = () => {
    if (productCode.trim()) {
      searchProduct(productCode);
    }
  };

  const expiryRef = useRef(null);
  const lotRef = useRef(null);
  const quantityRef = useRef(null);

  // 로딩 중
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 헤더 */}
      <div className="bg-blue-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-3 flex justify-between items-center">
          <h1 className="text-lg font-bold">현장 보고</h1>
          <div className="flex items-center gap-2">
            {canAccessAllPages && (
              <button onClick={() => router.push('/')} className="p-2 hover:bg-blue-700 rounded-lg">
                <Home size={20} />
              </button>
            )}
            <button onClick={logout} className="p-2 hover:bg-blue-700 rounded-lg">
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4">
        {/* 유형 선택 탭 */}
        <div className="flex mb-4 bg-white rounded-xl overflow-hidden shadow">
          <button
            onClick={() => setItemType('실물발견')}
            className={`flex-1 py-4 flex items-center justify-center gap-2 font-bold transition-colors ${
              itemType === '실물발견'
                ? 'bg-emerald-500 text-white'
                : 'bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            <Package size={20} />
            실물발견
          </button>
          <button
            onClick={() => setItemType('실물없음')}
            className={`flex-1 py-4 flex items-center justify-center gap-2 font-bold transition-colors ${
              itemType === '실물없음'
                ? 'bg-red-500 text-white'
                : 'bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            <PackageX size={20} />
            실물없음
          </button>
        </div>

        {/* 입력 폼 */}
        <div className="bg-white rounded-xl shadow p-4 space-y-4">
          {/* 상품코드 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              상품코드 <span className="text-red-500">*</span>
            </label>
            <input
              ref={productCodeRef}
              type="text"
              value={productCode}
              onChange={(e) => {
                setProductCode(e.target.value.toUpperCase());
                setProductName(''); // 변경 시 상품명 초기화
              }}
              onKeyDown={(e) => handleKeyDown(e, expiryRef, true)}
              onBlur={handleProductCodeBlur}
              placeholder="상품코드 입력 후 엔터"
              className="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
              autoFocus
            />
            {/* 상품명 표시 */}
            {searching ? (
              <div className="mt-1 text-sm text-gray-400">조회 중...</div>
            ) : productName ? (
              <div className="mt-1 text-sm text-emerald-600 font-medium">{productName}</div>
            ) : null}
          </div>

          {/* 유통기한 & LOT */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">유통기한</label>
              <input
                ref={expiryRef}
                type="text"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, lotRef)}
                placeholder="20251231"
                className="w-full px-3 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">LOT</label>
              <input
                ref={lotRef}
                type="text"
                value={lot}
                onChange={(e) => setLot(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, quantityRef)}
                placeholder="LOT"
                className="w-full px-3 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* 수량 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              수량 <span className="text-red-500">*</span>
            </label>
            <input
              ref={quantityRef}
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, null)}
              placeholder="수량"
              className="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* 등록 버튼 */}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className={`w-full py-4 rounded-xl text-white font-bold text-lg ${
              itemType === '실물발견'
                ? 'bg-emerald-500 hover:bg-emerald-600'
                : 'bg-red-500 hover:bg-red-600'
            } ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {submitting ? '등록 중...' : '등록'}
          </button>
        </div>

        {/* 사용자 정보 */}
        <div className="mt-4 text-center text-sm text-gray-500">
          {user?.email} {isAdmin && <span className="text-blue-600">(관리자)</span>}
        </div>
      </div>
    </div>
  );
};

export default FoundItemsPage;
