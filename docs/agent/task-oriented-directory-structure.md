Title: Agentic Tooling Across Multiple Repositories

URL Source: https://ricky-dev.com/coding/2026/01/agentic-tooling-across-multiple-repositories/

Published Time: 2026-01-10

Markdown Content:
In my organization, we have a great number of repositories that contain overlapping logic. For example, to manage our large number of cloud environments, we have separate repositories just for Terraform. We've split up our code based on purpose and audience to better organize our work. However, this creates challenges when we need to make a change that spans multiple repositories. This challenge has always existed, but it was manageable when doing work manually – you can just open the multiple repositories in your editor of choice and have multiple terminal tabs open for working with git in each repository.

But as we lean into the use of agentic tooling (AI agents that can act on your behalf) to automate repetitive tasks – especially when we want those tools to perform broader changes that require context across multiple repositories – this becomes a bigger challenge. In this post I’ll walk through how I use git worktrees and a simple directory convention to give those agents the right context to work safely across many repos.

Organizing My Repositories
--------------------------

Before we get into the solution, let's take a look at how I organize my repositories locally. My usual setup is to place all of my repositories in a `~/projects` directory structure, usually by organization, then by full project namespace that matches our remote repository.

So, you'd expect to see a structure like this on my laptop:

```
~/projects/
| - acme-corp/ |
| ------------ |  |infra-team/
| -   | -   | - terraform/account-provisioning/ |
| --- | --- | --------------------------------- |infra-team/terraform/networking/
| -   | -   | - infra-team/terraform/networking-modules/ |
| --- | --- | ------------------------------------------ |shared/terraform/service-resources/
| -   | -   | - shared/terraform/service-modules/ |
| --- | --- | ----------------------------------- |app-devs/frontend-app/
| -   | -   | - app-devs/backend-api/ |
| --- | --- |some-product-team/backend-services/
| - public/some-open-source-repo/
```

A High-Level Solution – Directory Structure with Git Worktrees
--------------------------------------------------------------

My idea was to use git worktrees to create a single directory structure that contains multiple repositories, all synced to the same branch name. This way, I can create a workspace for a specific task that requires context across multiple repositories. The branch-named parent directory provides a space for defining context for the task at hand and provides a workspace for agentic tooling without polluting the individual repositories.

Git Worktrees
-------------

Git worktrees let you create additional working directories for the same repository. Each worktree is tied to a branch and shares the same `.git` data, so you don’t need to reclone. Creating a worktree is fast and uses little disk space, and remote operations (fetch, pull, push) are shared across the main repo and all worktrees.

The common use case is when you need to quickly pivot to working on another problem/feature, but you have a lot of WIP stuff in your working directory. Most developers I know would go about stashing their changes or creating a "WIP" commit, then switching branches. With git worktrees, you can just create a new working directory for the branch you want to work on and leave your main working directory alone. It's very handy, but not a tool that most people reach for often (maybe not often enough).

Git Worktree Directory Structure
--------------------------------

In my new scheme, I've started to create a directory structure that looks like `~/projects/worktrees/<branch-name>/<repository-name>`.

So, if we think of a really broad task, like "scan all Terraform modules using Trivy and fix any issues found", I might create a worktree structure like this:

```
~/projects/worktrees/scan-fix-trivy-issues/
| - terraform-account-provisioning/
| - terraform-networking/
| - terraform-networking-modules/
| - terraform-service-resources/
| - terraform-service-modules/
```

This has some really big benefits:

*   Each task can include (or not) repositories that are needed
*   All repositories are checked out to the same branch name, making merge-request/pull-request tracking easier.
*   The parent directory (`scan-fix-trivy-issues`) provides a workspace for the task, outside of any one repository
*   Agentic tools can be run from the parent directory, providing a single context for all repositories involved in the task.

Giving Context
--------------

The big "aha" moment was that the parent directory (the branch name) provides a context for the task at hand. This is really powerful when using agentic tooling, because the tooling can be run from the parent directory, and it can operate on all repositories within that context. **So far, I'm starting my tasks with two key files: `AGENTS.md` and `PLAN.md`.**

The `AGENTS.md` file is already a well-known pattern for providing seed context for agentic tooling. By placing this file in the parent directory, I can give high-level information about the directory structure and instructions for the agents to read `AGENTS.md` files in each repository, and to reference the `PLAN.md` file for the overall plan.

```
This directory contains multiple repositories related to scanning and fixing Trivy issues in our Terraform modules.
Each repository is checked out to the same branch name: `scan-fix-trivy-issues`.
Follow the plan outlined in the `PLAN.md` file to complete the task.
For each repository, please read the `AGENTS.md` file located in the root of the repository for specific instructions related to that repository.
When making changes, please create git commits with clear messages, push changes to the remote repository, and create merge requests as needed.
Track all created merge requests in a `MERGE_REQUESTS.md` file in this parent directory.
```

In my `PLAN.md` file, I've found that providing a high-level outline of the steps, and a checklist of the steps to perform, helps the agent stay on track and also provides a way for the agent to keep track of progress. You're likely to pause the overall task execution to focus on a specific issue, to push changes and address CI/CD results, or if you need to reboot your computer. At any time, you can just tell your agent to "continue the plan" and it can pick up where it left off.

```
# Plan: Scan and fix Trivy issues

- [ ] Scan all Terraform modules with Trivy
- [ ] Triage findings and propose fixes
- [ ] Apply fixes and run `terraform validate`
- [ ] Open merge requests and record them in `MERGE_REQUESTS.md`
```

### Shell Alias for Creating Worktrees

Now, one of the pain points of working with git worktrees is that the commands can be a bit verbose. To make it easier to create these worktree structures, I've created a few ZSH aliases that automate the process, especially focusing on this workflow.

```
# Create a new worktree for a new branch
# Usage: wt-new <branch-name>
wt-new() {
    if [ -z "$1" ]; then
        echo "Error: Branch name required"
        echo "Usage: wt-new <branch-name>"
        return 1
    fi
    
    local branch_name="$1"
    local repo_name=$(basename $(git rev-parse --show-toplevel 2>/dev/null))
    
    if [ -z "$repo_name" ]; then
        echo "Error: Not in a git repository"
        return 1
    fi
    
    local worktree_path="$HOME/projects/worktrees/$branch_name/$repo_name"
    
    # Create the directory structure if it doesn't exist
    mkdir -p "$HOME/projects/worktrees/$branch_name"
    
    # Create the worktree with a new branch
    if git worktree add -b "$branch_name" "$worktree_path"; then
        echo "✓ Worktree created at: $worktree_path"
        
        # Copy all .envrc files from the source repository
        local source_repo=$(git rev-parse --show-toplevel)
        local envrc_files=$(find "$source_repo" -name ".envrc" -not -path "*/\.git/*" 2>/dev/null)
        
        if [ -n "$envrc_files" ]; then
            echo "$envrc_files" | while read -r envrc_file; do
                local rel_path="${envrc_file#$source_repo/}"
                local target_dir="$worktree_path/$(dirname "$rel_path")"
                mkdir -p "$target_dir"
                cp "$envrc_file" "$worktree_path/$rel_path"
                echo "✓ Copied $rel_path"
            done
        fi
        
        cd "$worktree_path"
    else
        echo "✗ Failed to create worktree"
        return 1
    fi
}
```

This alias, `wt-new`, takes a branch name as an argument, creates the necessary directory structure, and sets up a new worktree for the current repository. It also copies any `.envrc` files from the source repository to the new worktree, ensuring that environment configurations are preserved.

The Real Magic
--------------

Now, if you're paying attention, you might think this is a pretty nice way to create a per-task structure, but there's some extra steps that _REALLY_ turn this whole thing into pure magic.

With this directory layout in place, agentic tooling gets really interesting when you add a few conventions:

1.   Instructing the agent to create git commits as it works
2.   Instructing the agent to push changes to the remote repository when it completes a step (while specifying git push options to automatically create a merge-request on the remote)
3.   Instructing the agent to keep track of merge requests in a `MERGE_REQUESTS.md` file in the parent directory
4.   Giving the agent access to CI/CD pipelines so it can see output of tests, scans, and other jobs (through an MCP server, for example)
5.   Instructing the agent to document instructions I provide in the `./AGENTS.md` file, so that any refinements I give it during the chat session are captured (I find this helps to keep important instructions in the AI context)
6.   Have a tool like pre-commit already running on the repositories – the agent will see the pre-commit failures and fix them as it goes

Demonstrating the Workflow
--------------------------

To demonstrate the workflow, let's say I want to create a new worktree for the branch `scan-fix-trivy-issues` for a few repositories, I would navigate to each repository and run `wt-new scan-fix-trivy-issues`.

```
cd ~/projects/acme-corp/infra-team/terraform/account-provisioning
wt-new scan-fix-trivy-issues
cd ~/projects/acme-corp/infra-team/terraform/networking
wt-new scan-fix-trivy-issues
cd ~/projects/acme-corp/infra-team/terraform/networking-modules
wt-new scan-fix-trivy-issues
```

Next, create my `AGENTS.md` and `PLAN.md` files in the `scan-fix-trivy-issues` directory to provide context for the task.

```
~/projects/worktrees/scan-fix-trivy-issues/
| - terraform-account-provisioning/
| - terraform-networking/
| - terraform-networking-modules/
| - AGENTS.md
| - PLAN.md
```

From there, I can just run my favorite AI tool (`codex`) in the parent directory and prompt it to `Get started`. It will read the `AGENTS.md` file by default, which tells it to read the `PLAN.md` file and follow the steps outlined there.

At some key points, I'll instruct the agent to `push changes`, which will cause it to create commits, push them to the remote repository, and create merge requests automatically and log them in the `MERGE_REQUESTS.md` file. I can tell it to `Check the status of the merge request pipelines` and it'll go off and look at the output of the CI/CD jobs and get to work on troubleshooting failures.

Early Results
-------------

I've only been using this workflow for a couple of days, but it's been extremely promising. There have been a few key moments where the agent has (rightly) indicated that it might cause an outage with a change and I've been able to pull in additional repositories (like our repositories that manage helm charts and environment-specific input values) to give it more context to make more "informed decisions".

I also very much like that I have given it a large sandbox where it can play safely. The worktrees are all created with a branch, so there's a low risk that I'll have the wrong branch checked out. I also don't have to worry about a lot of pending changes in my main working directories and it getting in the way of other work. In fact, I've found myself already setting up this context, setting the agent off to do work, and then I'll switch my focus to something else in the main working directory. As someone who has been very hesitant to relinquish control to AI tools, this has been a really nice way to reap the benefits while still having some confidence that it's not going to make a huge mess.

(A human wrote this blog post, but GPT-5.1 was used for editing assistance. Use of emdashes was a human choice. 😄)