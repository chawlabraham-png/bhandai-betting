-- Run this in Supabase SQL Editor to add the new commission fields to the users table
ALTER TABLE public.betting_users 
ADD COLUMN IF NOT EXISTS match_commission DECIMAL(5,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS fancy_commission DECIMAL(5,2) DEFAULT 0.00;
