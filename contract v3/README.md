## Data Flow

I seperated pool data with Pool and PoolLedger accounts. To be honest, We can merge both accounts.

But I wanted to store constant and variable data of pool in each account.

Pool account is for constant data and PoolLedger account is for variable data.


And in Anchor, if account size is greater than 1024 bytes, we cannot use anchor interpertor for structure.

So I used to tradition method for updating account data.

Lets consider our PoolLedger account size.

daily size = 16 bytes ( total stake token : 8bytes and income : 8bytes)
year size = 16 * 365.25 = 5844 bytes
10 years size = 58440 bytes.

Anchor provides an easy way to analyze your account structure. However, the anchor framework can use this tool up to 1024 bytes. So we have to access account data.

## Algorithm

1. Stake / Unstake

We have to check accounts.

	- If transaction time is smaller than starting time of pool, this pool is not started yet.
	
	- If transaction time is greater than ending time(10 years in our case) of pool, this pool is already ended.
	
	- We check if pool and pool ledger is a pair.
	
	- We check if account that will get(for "stake")/send(for "unstake") staking token is one of pool.


Then we update ledger data.

```stake
	(getting last changed ledger - when we stake/unstake, we put in next ledger. So we have to get next ledger data)

	last_ledger = get_daily_ledger(last_number + 1)

	(set current ledger - we change next ledger so we can set income to zero)

	set_daily_ledger(cur_number+1, {

		total_stake_token : last_ledger.total_stake_token +/- amount,

		income : 0,

		changed : true

	})
```

Then we mint one nft with metadatawxtended.

Metadata Extended Structure

values : If you stake 70 ddd token, then nft's values = 70

number : when you minted this nft

withdraw_number : last number you withdrawn

2. Deposit

Here, We also have to check accounts for the first time. This processing is simmilar to "Stake/Unstake" processing.

In Deposit, income is added to current ledger(not next ledger).

```deposit
	if( cur_number = last_number ){

		cur_ledger = get_daily_ledger(cur_number)

		set_daily_ledger(cur_number, {

			total_stake_token : cur_ledger.total_stake_token,

			income : cur_ledger.income + amount,

			changed : true

		})

		(we have to set next ledger)

		if( !last_ledger.changed ){

			set_daily_ledger(cur_number+1, {

				total_stake_token : cur_ledger.total_stake_token,

				income : 0,

				changed : last_ledger.changed,

			})

		}

	} else {

		last_ledger = get_daily_ledger(last_number)

		set_daily_ledger(cur_number,{

			total_stake_token : last_ledger.total_stake_token,

			income : cur_ledger.income + amount,

			changed : true

		})

		(We have to set next ledger)

		set_daily_ledger(cur_number+1, {

			total_stake_token : last_ledger.total_stake_token,

			income : 0,

			changed : false,

		})

	}
```

In "deposit", users burn their nft.

3. Withdraw

We get total withdrawable amount for one nft.(from last withdrawn time to current time).

And then Pool sends token(total amount) to user.

```withdraw
	for(i in metadata_extended.withdrawn_number..number){

		ledger = get_daily_ledger(i)

		total += ledger.income * metadata_extended.value / ledger.total_stake_token

	}
```

At the end, we update withdraw time of staker account.
