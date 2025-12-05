-- Create erp_requests table for storing warehouse movement ERP request numbers
CREATE TABLE IF NOT EXISTS erp_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  erp_number TEXT NOT NULL UNIQUE,
  from_location TEXT NOT NULL,
  to_location TEXT NOT NULL,
  total_ea INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on erp_number for faster lookups
CREATE INDEX IF NOT EXISTS idx_erp_requests_erp_number ON erp_requests(erp_number);

-- Create index on created_at for date-based queries
CREATE INDEX IF NOT EXISTS idx_erp_requests_created_at ON erp_requests(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE erp_requests ENABLE ROW LEVEL SECURITY;

-- Create policy to allow authenticated users to insert
CREATE POLICY "Allow authenticated users to insert erp_requests"
  ON erp_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create policy to allow authenticated users to select
CREATE POLICY "Allow authenticated users to select erp_requests"
  ON erp_requests
  FOR SELECT
  TO authenticated
  USING (true);

-- Create policy to allow public (anon) users to insert
CREATE POLICY "Allow anon users to insert erp_requests"
  ON erp_requests
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Create policy to allow public (anon) users to select
CREATE POLICY "Allow anon users to select erp_requests"
  ON erp_requests
  FOR SELECT
  TO anon
  USING (true);
