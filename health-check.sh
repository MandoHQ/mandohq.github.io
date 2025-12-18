# In the original repository we'll just print the result of status checks,
# without committing. This avoids generating several commits that would make
# later upstream merges messy for anyone who forked us.
commit=true
origin=$(git remote get-url origin)
if [[ $origin == *statsig-io/statuspage* ]]
then
  commit=false
fi

KEYSARRAY=()
URLSARRAY=()
FAILED_CHECKS=()

urlsConfig="./urls.cfg"
echo "Reading $urlsConfig"
while IFS= read -r line || [[ -n "$line" ]];
do
  echo "  $line"
  IFS='=' read -ra TOKENS <<< "$line"
  KEYSARRAY+=(${TOKENS[0]})
  URLSARRAY+=(${TOKENS[1]})
done < "$urlsConfig"

echo "***********************"
echo "Starting health checks with ${#KEYSARRAY[@]} configs:"

mkdir -p logs

for (( index=0; index < ${#KEYSARRAY[@]}; index++))
do
  key="${KEYSARRAY[index]}"
  url="${URLSARRAY[index]}"
  echo "  $key=$url"

  for i in 1 2 3 4; 
  do
    response=$(curl --write-out '%{http_code}' --silent --output /dev/null $url)
    if [ "$response" -eq 200 ] || [ "$response" -eq 202 ] || [ "$response" -eq 301 ] || [ "$response" -eq 302 ] || [ "$response" -eq 307 ]; then
      result="success"
    else
      result="failed"
    fi
    if [ "$result" = "success" ]; then
      break
    fi
    sleep 5
  done
  dateTime=$(date +'%Y-%m-%d %H:%M')
  if [[ $commit == true ]]
  then
    echo $dateTime, $result >> "logs/${key}_report.log"
    # By default we keep 2000 last log entries.  Feel free to modify this to meet your needs.
    echo "$(tail -2000 logs/${key}_report.log)" > "logs/${key}_report.log"
  else
    echo "    $dateTime, $result"
  fi
  
  # Track failures for notifications
  if [ "$result" = "failed" ]; then
    FAILED_CHECKS+=("• ${key}: ${url}")
  fi
done

# Export failures to GitHub Actions outputs
if [ ${#FAILED_CHECKS[@]} -gt 0 ]; then
  echo "has_failures=true" >> $GITHUB_OUTPUT
  # Join array with newlines for the output
  FAILED_LIST=$(printf '%s\n' "${FAILED_CHECKS[@]}")
  echo "failed_checks<<EOF" >> $GITHUB_OUTPUT
  echo "$FAILED_LIST" >> $GITHUB_OUTPUT
  echo "EOF" >> $GITHUB_OUTPUT
  echo "⚠️  ${#FAILED_CHECKS[@]} health check(s) failed!"
else
  echo "has_failures=false" >> $GITHUB_OUTPUT
  echo "✅ All health checks passed!"
fi

if [[ $commit == true ]]
then
  # Let's make Vijaye the most productive person on GitHub.
  git config user.name 'Mando'
  git config --global user.email 'prithviraj.gawande@mando.work'
  git add -A --force logs/
  git commit -am '[Automated] Update Health Check Logs'
  git push
fi
