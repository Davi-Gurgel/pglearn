// Queries on the Pagila sample database that each show one thing worth
// explaining. Picked while exploring the plans in earlier milestones.
export interface Example {
  title: string;
  sql: string;
}

export const examples: Example[] = [
  {
    title: "Index Scan: find one film by title",
    sql: "select film_id, title, rating\nfrom film\nwhere title = 'ACADEMY DINOSAUR'",
  },
  {
    title: "Seq Scan: a LIKE the index cannot serve",
    sql: "select film_id, title\nfrom film\nwhere title like 'JER%'",
  },
  {
    title: "Bitmap scans: full-text search",
    sql: "select film_id, title\nfrom film\nwhere fulltext @@ to_tsquery('boat & butler')",
  },
  {
    title: "Partition pruning: one month of payments",
    sql: "select count(*), sum(amount)\nfrom payment\nwhere payment_date >= '2022-02-01'\n  and payment_date < '2022-03-01'",
  },
  {
    title: "Joins: who rented what",
    sql: "select c.first_name, c.last_name, f.title, r.rental_date\nfrom rental r\njoin customer c on c.customer_id = r.customer_id\njoin inventory i on i.inventory_id = r.inventory_id\njoin film f on f.film_id = i.film_id\nwhere c.last_name = 'SMITH'",
  },
  {
    title: "Aggregate: films per rating",
    sql: "select rating, count(*), avg(length)\nfrom film\ngroup by rating\norder by count(*) desc",
  },
  {
    title: "Sort spills to disk",
    sql: "select *\nfrom rental\norder by return_date",
  },
  {
    title: "Limit stops early",
    sql: "select title, length\nfrom film\norder by length desc\nlimit 5",
  },
  {
    title: "DELETE: Run changes data",
    sql: "-- Explain rolls this back. Run commits the delete.\ndelete from payment\nwhere amount > 10\nreturning payment_id, amount",
  },
];
