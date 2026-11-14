#!/bin/zsh
# usage: search.sh <name> '<queries json array>'
cd /Users/pandaking/Desktop/房屋/3D模型
out=$(kjl-cli tools product_search search_catalog_library_text --params "{\"libraryRef\":\"product_j9j34pfgwula_library_1\",\"queries\":$2,\"includeImages\":true,\"imageLimit\":12,\"imageResolution\":\"low\"}")
f=$(echo "$out" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.data.savedTo||'')})")
if [ -z "$f" ]; then f=.kjl/$1.json; echo "$out" > $f; fi
mkdir -p .kjl/sheets; python3 .kjl/tools/sheet.py "$f" .kjl/sheets/$1
