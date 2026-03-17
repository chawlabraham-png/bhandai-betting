-- Run this in Supabase SQL Editor to finalize the new Admin schema
ALTER TABLE public.betting_users 
ADD COLUMN IF NOT EXISTS partnership_share DECIMAL(5,2) DEFAULT 0.00;

-- Optional: Create a transaction log table to track when an Admin gives coins to an Agent
CREATE TABLE IF NOT EXISTS public.credit_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID REFERENCES public.betting_users(id),
    receiver_id UUID REFERENCES public.betting_users(id),
    amount DECIMAL(15,2) NOT NULL,
    transaction_type VARCHAR(50) NOT NULL, -- 'DEPOSIT', 'WITHDRAWAL', 'SETTLEMENT'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Enable RLS on the new table
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own transactions" 
ON public.credit_transactions 
FOR SELECT 
USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
