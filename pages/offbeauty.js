import { useState } from 'react';
import Head from 'next/head';
import * as XLSX from 'xlsx';
import AuthLayout from '@/components/AuthLayout';
import supabase from '@/lib/supabase';

export default function OffBeauty() {
  const [originalData, setOriginalData] = useState([]);
  const [processedData, setProcessedData] = useState([]);
  const [error, setError] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [processing, setProcessing] = useState(false);

  // 박스 타입 결정 (무게 기준) - 개별 상품 무게 기준
  const getBoxType = (weight) => {
    if (!weight || weight === 0) return '-';
    if (weight >= 25) return '취급제한';
    if (weight >= 20) return '이형';
    if (weight >= 15) return '대2';
    if (weight >= 10) return '대1';
    if (weight >= 5) return '중';
    return '소';
  };

  // 박스 수량 계산 (무게 기준으로 몇 박스 필요한지)
  const calculateBoxCount = (weight, boxType) => {
    if (!weight || weight === 0 || boxType === '-') return 0;

    // 박스타입별 최대 무게
    const boxMaxWeight = {
      '취급제한': 30, // 25kg 이상이지만 최대 30kg 가정
      '이형': 25,
      '대2': 20,
      '대1': 15,
      '중': 10,
      '소': 5
    };

    const maxWeight = boxMaxWeight[boxType] || 5;
    return Math.ceil(weight / maxWeight);
  };

  // 박스타입별 색상 (텍스트용)
  const getBoxTypeTextColor = (boxType) => {
    const colors = {
      '취급제한': 'text-red-600 font-bold',
      '이형': 'text-red-500 font-bold',
      '대2': 'text-orange-600 font-bold',
      '대1': 'text-orange-500 font-bold',
      '중': 'text-blue-600 font-bold',
      '소': 'text-green-600 font-bold',
      '-': 'text-gray-400'
    };
    return colors[boxType] || 'text-gray-400';
  };

  // Supabase에서 상품 정보 조회
  const fetchProductInfo = async (productCodes) => {
    const uniqueCodes = [...new Set(productCodes.filter(code => code))];
    if (uniqueCodes.length === 0) return {};

    const { data, error } = await supabase
      .from('products')
      .select('product_code, ea_per_box, weight_per_box, weight_per_ea')
      .in('product_code', uniqueCodes);

    if (error) {
      console.error('Supabase error:', error);
      return {};
    }

    const productInfoMap = {};
    data.forEach(product => {
      productInfoMap[product.product_code] = {
        eaPerBox: product.ea_per_box || 0,
        weightPerBox: product.weight_per_box || 0,
        weightPerEa: product.weight_per_ea || 0
      };
    });

    return productInfoMap;
  };

  // 엑셀 파일 업로드 처리
  const handleExcelUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setError('');
    setUploadedFileName(file.name);
    setProcessing(true);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // 1행이 헤더
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { range: 0 });

        if (jsonData.length === 0) {
          setError('데이터가 없습니다.');
          setProcessing(false);
          return;
        }

        // 컬럼명 동적 매핑
        const firstRow = jsonData[0];
        const columns = Object.keys(firstRow);

        const findColumn = (keywords) => {
          return columns.find(col =>
            keywords.some(keyword => col.toLowerCase().includes(keyword.toLowerCase()))
          );
        };

        // 수취인 컬럼 찾기 (연락처, 주소 제외)
        const recipientCol = columns.find(col =>
          col.includes('수취인') && !col.includes('연락처') && !col.includes('주소')
        );

        const newColMap = {
          productName: findColumn(['품명']),
          productCode: findColumn(['품번']),
          quantity: findColumn(['수량']),
          recipient: recipientCol || findColumn(['수취인']),
          phone: findColumn(['연락처', '전화']),
          address: findColumn(['주소']),
        };

        // 필수 컬럼 체크
        if (!newColMap.recipient || !newColMap.address || !newColMap.quantity) {
          setError('필수 컬럼(수취인, 수취인주소, 수량)을 찾을 수 없습니다.');
          setProcessing(false);
          return;
        }

        setOriginalData(jsonData);

        // 모든 품번 수집
        const allProductCodes = jsonData.map(row =>
          (row[newColMap.productCode] || '').toString().trim()
        );

        // Supabase에서 상품 정보 조회
        const productInfoMap = await fetchProductInfo(allProductCodes);

        // 수취인+주소 기준으로 그룹화
        const recipientMap = new Map();

        jsonData.forEach((row) => {
          const recipient = (row[newColMap.recipient] || '').toString().trim();
          const address = (row[newColMap.address] || '').toString().trim();
          const phone = (row[newColMap.phone] || '').toString().trim();
          const quantity = parseInt(row[newColMap.quantity], 10) || 0;
          const productName = (row[newColMap.productName] || '').toString().trim();
          const productCode = (row[newColMap.productCode] || '').toString().trim();

          // 상품 정보 조회
          const productInfo = productInfoMap[productCode] || { eaPerBox: 0, weightPerBox: 0, weightPerEa: 0 };

          // 무게 계산
          let itemWeight = 0;
          if (productInfo.weightPerEa > 0) {
            itemWeight = quantity * productInfo.weightPerEa;
          } else if (productInfo.weightPerBox > 0 && productInfo.eaPerBox > 0) {
            itemWeight = (quantity / productInfo.eaPerBox) * productInfo.weightPerBox;
          }

          // 개별 상품의 박스타입 결정
          const boxType = getBoxType(itemWeight);
          const boxCount = calculateBoxCount(itemWeight, boxType);

          const key = `${recipient}|||${address}`;

          if (!recipientMap.has(key)) {
            recipientMap.set(key, {
              recipient,
              address,
              phone,
              items: []
            });
          }

          const entry = recipientMap.get(key);
          entry.items.push({
            productName,
            productCode,
            quantity,
            weight: itemWeight,
            boxType,
            boxCount
          });
        });

        // 배열로 변환 (수취인명 순 정렬)
        const sortedGroups = Array.from(recipientMap.values()).sort((a, b) =>
          a.recipient.localeCompare(b.recipient, 'ko')
        );

        setProcessedData(sortedGroups);
        setProcessing(false);

      } catch (err) {
        console.error('엑셀 파일 처리 오류:', err);
        setError('엑셀 파일 처리 중 오류가 발생했습니다: ' + err.message);
        setProcessing(false);
      }
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <AuthLayout>
      <Head>
        <title>오프뷰티 택배</title>
      </Head>

      <main className="py-6">
        <div className="max-w-7xl mx-auto px-4">
          <h1 className="text-2xl font-bold text-center text-gray-800 mb-6">
            오프뷰티 택배
          </h1>

          {/* 엑셀 업로드 */}
          <div className="mb-6 p-4 bg-white rounded-lg shadow">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              엑셀 파일 업로드 (1행 헤더)
            </label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleExcelUpload}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {uploadedFileName && !processing && (
              <p className="mt-2 text-sm text-green-600">
                ✓ {uploadedFileName} ({originalData.length}건)
              </p>
            )}
            {processing && (
              <p className="mt-2 text-sm text-blue-600">처리 중...</p>
            )}
          </div>

          {/* 에러 메시지 */}
          {error && (
            <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">
              {error}
            </div>
          )}

          {/* 상세 테이블 */}
          {processedData.length > 0 && (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="px-4 py-3 bg-gray-100 font-semibold border-b">
                전체 수취인 ({processedData.length}건)
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="py-2 px-3 text-center border-b w-12">No</th>
                      <th className="py-2 px-3 text-left border-b">수취인</th>
                      <th className="py-2 px-3 text-left border-b">연락처</th>
                      <th className="py-2 px-3 text-left border-b">주소</th>
                      <th className="py-2 px-3 text-left border-b">상품</th>
                      <th className="py-2 px-3 text-center border-b w-16">수량</th>
                      <th className="py-2 px-3 text-center border-b w-24">박스타입</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processedData.map((item, idx) => (
                      item.items.map((product, pIdx) => (
                        <tr key={`${idx}-${pIdx}`} className={`border-b ${pIdx === 0 ? 'bg-gray-50' : ''}`}>
                          {pIdx === 0 && (
                            <>
                              <td rowSpan={item.items.length} className="py-2 px-3 text-center font-bold text-blue-600 border-r">{idx + 1}</td>
                              <td rowSpan={item.items.length} className="py-2 px-3 font-medium border-r">{item.recipient}</td>
                              <td rowSpan={item.items.length} className="py-2 px-3 border-r">{item.phone}</td>
                              <td rowSpan={item.items.length} className="py-2 px-3 border-r">{item.address}</td>
                            </>
                          )}
                          <td className="py-2 px-3">{product.productCode} {product.productName}</td>
                          <td className="py-2 px-3 text-center">{product.quantity}</td>
                          <td className={`py-2 px-3 text-center ${getBoxTypeTextColor(product.boxType)}`}>
                            {product.boxType !== '-' ? `${product.boxType} ${product.boxCount}BOX` : '-'}
                          </td>
                        </tr>
                      ))
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </AuthLayout>
  );
}
