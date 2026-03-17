-- ==========================================
-- bhandai.com/betting - Supabase Schema
-- Architecture: Polymarket-style Event Trading
-- ==========================================

-- 1. Users & Hierarchy (Admin -> Agent -> Client)
CREATE TABLE public.betting_users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    login_id VARCHAR(10) UNIQUE NOT NULL, 
    role VARCHAR(10) NOT NULL CHECK (role IN ('ADMIN', 'AGENT', 'CLIENT')),
    name VARCHAR(255),
    phone VARCHAR(20),
    parent_id UUID REFERENCES public.betting_users(id), 
    balance NUMERIC(15, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Events & Markets (e.g. "IPL Finals: CSK vs MI")
CREATE TABLE public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL, -- e.g., 'Cricket', 'Politics'
    image_url TEXT,
    resolution_date TIMESTAMP WITH TIME ZONE,
    is_resolved BOOLEAN DEFAULT false,
    winning_outcome VARCHAR(50), -- e.g., 'CSK' or 'MI'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Tradeable Outcomes (The "Shares" - e.g. 'Yes'/'No' or 'Team A'/'Team B')
CREATE TABLE public.outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL,
    current_price NUMERIC(5, 2) NOT NULL CHECK (current_price >= 0 AND current_price <= 100), -- Price in cents (0 to 100)
    total_volume NUMERIC(15, 2) DEFAULT 0
);

-- 4. User Portfolio Positions (What they actually hold)
CREATE TABLE public.portfolio_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.betting_users(id),
    outcome_id UUID REFERENCES public.outcomes(id),
    shares_owned NUMERIC(15, 2) DEFAULT 0,
    avg_buy_price NUMERIC(5, 2) DEFAULT 0,
    UNIQUE(user_id, outcome_id)
);

-- 5. Order History (Buy / Sell transactions)
CREATE TABLE public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.betting_users(id),
    outcome_id UUID REFERENCES public.outcomes(id),
    order_type VARCHAR(10) CHECK (order_type IN ('BUY', 'SELL')),
    shares NUMERIC(15, 2) NOT NULL,
    price_per_share NUMERIC(5, 2) NOT NULL,
    total_cost NUMERIC(15, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Enable RLS (Demo mode: allow authenticated access)
ALTER TABLE public.betting_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read/write for demo" 
  ON public.betting_users FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read events" 
  ON public.events FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow public read outcomes" 
  ON public.outcomes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow user read/write portfolio demo" 
  ON public.portfolio_positions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow user read/write orders demo" 
  ON public.orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
